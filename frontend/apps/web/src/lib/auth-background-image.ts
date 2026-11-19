import {
  IMAGE_HEADER_BYTES,
  imageDimensions,
  type ImageDimensions,
} from "./image-size";
import { fitSize, MAX_IMAGE_PIXELS } from "./image-shrink";
import { sniffType } from "./outgoing/attachment-sniff";

export const AUTH_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;
export const AUTH_BACKGROUND_FORMATS = {
  jpeg: { mime: "image/jpeg", extension: "jpg", label: "JPEG" },
  webp: { mime: "image/webp", extension: "webp", label: "WebP" },
  png: { mime: "image/png", extension: "png", label: "PNG" },
} as const;

export class BackgroundImageError extends Error {}

export type BackgroundFormat = keyof typeof AUTH_BACKGROUND_FORMATS;
type BackgroundSource = BackgroundFormat | "svg";
export type BackgroundImageInfo = {
  format: BackgroundSource;
  dimensions?: ImageDimensions;
  animated: boolean;
  tooManyPixels: boolean;
};
type CompressionOptions = { format: BackgroundFormat; maxSide: number } & (
  | { mode: "manual"; quality: number }
  | { mode: "target"; targetBytes: number; priority: "quality" | "size" }
);
export type BackgroundCompressionResult = ImageDimensions & {
  file: File;
  sourceDimensions: ImageDimensions;
  fits: boolean;
};

async function isAnimatedPng(file: File, header: Uint8Array) {
  // APNG places acTL before IDAT. Skip payloads when metadata extends past the header.
  for (let offset = 8; offset + 12 <= file.size; ) {
    const bytes =
      offset + 8 <= header.length
        ? header.subarray(offset, offset + 8)
        : new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunk = view.getUint32(4);
    if (chunk === 0x6163544c) return true; // acTL
    if (chunk === 0x49444154 || chunk === 0x49454e44) return false; // IDAT or IEND
    offset += 12 + view.getUint32(0);
  }
  return false;
}

export async function inspectBackgroundImage(
  file: File,
): Promise<BackgroundImageInfo> {
  const header = new Uint8Array(
    await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer(),
  );
  const mime = sniffType(header.subarray(0, 12));
  const format =
    mime === "image/jpeg"
      ? "jpeg"
      : mime === "image/png"
        ? "png"
        : mime === "image/webp"
          ? "webp"
          : null;
  if (format === null) {
    const start = new TextDecoder().decode(header).trimStart();
    if (
      /^<svg[\s/>]/i.test(start) ||
      /^<\?xml\b[\s\S]*?<svg[\s/>]/i.test(start)
    ) {
      return { format: "svg", animated: false, tooManyPixels: false };
    }
    throw new BackgroundImageError(
      "请选择 JPEG、PNG、WebP 或 SVG 格式的图片。",
    );
  }
  const dimensions = imageDimensions(header);
  if (!dimensions?.width || !dimensions.height)
    return { format, animated: false, tooManyPixels: false };
  const tooManyPixels = dimensions.width * dimensions.height > MAX_IMAGE_PIXELS;
  const animated =
    format === "png"
      ? !tooManyPixels && (await isAnimatedPng(file, header))
      : format === "webp" &&
        String.fromCharCode(...header.subarray(12, 16)) === "VP8X" &&
        Boolean(header[20] & 2);
  return { format, dimensions, animated, tooManyPixels };
}

async function decode(file: File, format: BackgroundFormat) {
  const blob = file.slice(0, file.size, AUTH_BACKGROUND_FORMATS[format].mime);
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Some browsers can display images their bitmap decoder rejects.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new BackgroundImageError("无法解码这张图片，请检查文件是否完整。");
  }
}

function* compressionCandidates(
  options: CompressionOptions,
  start: number,
  minSide: number,
) {
  if (options.mode === "manual") {
    yield {
      side: start,
      quality: options.format === "png" ? undefined : options.quality,
    };
    return;
  }
  const qualities = options.format === "png" ? [undefined] : [85, 70, 55, 35];
  let side = start;
  if (options.format !== "png" && options.priority === "quality") {
    const threeQuarters = Math.max(minSide, Math.floor(start * 0.75));
    const half = Math.max(minSide, Math.floor(start * 0.5));
    for (const largerSide of new Set([start, threeQuarters])) {
      if (largerSide > half) yield { side: largerSide, quality: 85 };
    }
    side = half;
  }
  while (true) {
    for (const quality of qualities) yield { side, quality };
    if (side === minSide) return;
    side = Math.max(minSide, Math.floor(side * 0.75));
  }
}

function encodeWebp(
  worker: Worker,
  pixels: ImageData,
  quality: number,
  signal: AbortSignal,
) {
  return new Promise<Blob>((resolve, reject) => {
    function onAbort() {
      reject(signal.reason);
    }
    signal.throwIfAborted();
    signal.addEventListener("abort", onAbort, { once: true });
    function finish(data?: ArrayBuffer) {
      signal.removeEventListener("abort", onAbort);
      if (data?.byteLength) resolve(new Blob([data], { type: "image/webp" }));
      else
        reject(
          new BackgroundImageError("WebP 编码失败，请重试或选择其他格式。"),
        );
    }
    worker.onmessage = (event: MessageEvent<ArrayBuffer | null>) =>
      finish(event.data ?? undefined);
    worker.onerror = () => finish();
    worker.onmessageerror = () => finish();
    try {
      worker.postMessage({ pixels, quality }, [pixels.data.buffer]);
    } catch {
      finish();
    }
  });
}

export async function compressBackgroundImage(
  file: File,
  info: BackgroundImageInfo,
  options: CompressionOptions,
  signal: AbortSignal,
): Promise<BackgroundCompressionResult> {
  if (info.format === "svg" || info.animated)
    throw new BackgroundImageError("SVG 和动态图仅支持原图上传。");
  if (info.tooManyPixels)
    throw new BackgroundImageError(
      "图片超过 5000 万像素，无法在浏览器内压缩。",
    );
  if (!info.dimensions)
    throw new BackgroundImageError("无法读取图片尺寸，请选择完整的图片文件。");
  signal.throwIfAborted();

  const { mime, extension } = AUTH_BACKGROUND_FORMATS[options.format];
  const limit =
    options.mode === "target" ? options.targetBytes : AUTH_BACKGROUND_MAX_BYTES;
  const image = await decode(file, info.format);
  const canvas = document.createElement("canvas");
  let worker: Worker | undefined;
  let pixels: ImageData | undefined;
  try {
    signal.throwIfAborted();
    const sourceDimensions = { width: image.width, height: image.height };
    const longEdge = Math.max(image.width, image.height);
    if (
      !image.width ||
      !image.height ||
      image.width * image.height > MAX_IMAGE_PIXELS
    ) {
      throw new BackgroundImageError("图片尺寸无效或超过 5000 万像素。");
    }
    const start = Math.min(options.maxSide, longEdge);
    let best: BackgroundCompressionResult | undefined;
    let drawnSide = 0;
    let ctx: CanvasRenderingContext2D | null = null;
    for (const { side, quality } of compressionCandidates(
      options,
      start,
      Math.min(start, 64),
    )) {
      signal.throwIfAborted();
      const { width, height } = fitSize(image.width, image.height, side);
      if (side !== drawnSide) {
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext("2d");
        if (!ctx) throw new BackgroundImageError("浏览器无法处理这张图片。");
        if (options.format === "jpeg") {
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, width, height);
        }
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image.source, 0, 0, width, height);
        pixels = undefined;
        drawnSide = side;
      }

      let blob = worker
        ? null
        : await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(
              resolve,
              mime,
              quality === undefined ? undefined : quality / 100,
            );
          });
      signal.throwIfAborted();
      if ((!blob || blob.type !== mime) && options.format === "webp" && ctx) {
        worker ??= new Worker("/background-webp/encoder.js", {
          type: "module",
        });
        pixels ??= ctx.getImageData(0, 0, width, height);
        // Keep the drawn pixels for subsequent quality attempts at this size.
        const input = new ImageData(pixels.data.slice(), width, height);
        blob = await encodeWebp(worker, input, quality ?? 85, signal);
      }
      signal.throwIfAborted();
      if (!blob?.size || blob.type !== mime)
        throw new BackgroundImageError(
          "浏览器无法生成所选格式的图片，请选择其他格式。",
        );

      const fits = blob.size <= Math.min(limit, AUTH_BACKGROUND_MAX_BYTES);
      if (fits || !best || blob.size < best.file.size) {
        const baseName = file.name.replace(/\.[^.]+$/, "") || "background";
        best = {
          file: new File([blob], `${baseName}.${extension}`, { type: mime }),
          width,
          height,
          sourceDimensions,
          fits,
        };
      }
      if (fits) break;
    }
    if (!best) throw new BackgroundImageError("无法生成压缩预览。");
    return best;
  } finally {
    worker?.terminate();
    canvas.width = canvas.height = 0;
    image.close();
  }
}
