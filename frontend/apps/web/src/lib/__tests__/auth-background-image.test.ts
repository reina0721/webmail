import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_BACKGROUND_MAX_BYTES,
  compressBackgroundImage,
  inspectBackgroundImage,
  type BackgroundImageInfo,
} from "../auth-background-image";

const source = new File(["source"], "wall.png", { type: "image/png" });
const info: BackgroundImageInfo = {
  format: "png",
  dimensions: { width: 1024, height: 512 },
  animated: false,
  tooManyPixels: false,
};
const sourceBitmap = { width: 1024, height: 512, close: vi.fn() };
const decode = vi.fn(async () => sourceBitmap);
const fillRect = vi.fn();
const drawImage = vi.fn();
const encodes: { mime?: string; quality?: number; side: number }[] = [];
let encodedSize: (side: number, quality?: number) => number;

function png(width: number, height: number, animated = false) {
  const bytes = new Uint8Array(animated ? 53 : 33);
  bytes.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
    0x44, 0x52,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  if (animated) bytes.set([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c], 33);
  return new File([bytes], "wall.png");
}

beforeEach(() => {
  decode.mockClear();
  sourceBitmap.close.mockClear();
  fillRect.mockClear();
  drawImage.mockClear();
  encodes.length = 0;
  encodedSize = () => 1000;
  vi.stubGlobal("createImageBitmap", decode);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ fillRect, drawImage }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    mime,
    quality,
  ) {
    const side = Math.max(this.width, this.height);
    encodes.push({ mime, quality, side });
    callback(
      new Blob([new Uint8Array(encodedSize(side, quality))], { type: mime }),
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("authentication background compression", () => {
  it.each([
    ["jpeg", "image/jpeg", "wall.jpg", 0.75, true],
    ["webp", "image/webp", "wall.webp", 0.75, false],
    ["png", "image/png", "wall.png", undefined, false],
  ] as const)(
    "encodes %s with the expected quality, size and background",
    async (format, mime, name, quality, white) => {
      const result = await compressBackgroundImage(
        source,
        info,
        { mode: "manual", format, maxSide: 400, quality: 75 },
        new AbortController().signal,
      );
      expect(result.file).toMatchObject({ type: mime, name, size: 1000 });
      expect(result).toMatchObject({ width: 400, height: 200, fits: true });
      expect(encodes).toEqual([{ mime, quality, side: 400 }]);
      expect(drawImage).toHaveBeenCalledWith(sourceBitmap, 0, 0, 400, 200);
      expect(fillRect).toHaveBeenCalledTimes(white ? 1 : 0);
      if (white)
        expect(fillRect.mock.contexts[0]).toMatchObject({ fillStyle: "#fff" });
      expect(sourceBitmap.close).toHaveBeenCalledOnce();
    },
  );

  it("uses the oriented dimensions and never enlarges the source", async () => {
    decode.mockResolvedValueOnce({ ...sourceBitmap, width: 512, height: 1024 });
    const result = await compressBackgroundImage(
      source,
      { ...info, format: "jpeg" },
      { mode: "manual", format: "jpeg", maxSide: 2560, quality: 85 },
      new AbortController().signal,
    );
    expect(decode).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/jpeg" }),
      { imageOrientation: "from-image" },
    );
    expect(result).toMatchObject({
      width: 512,
      height: 1024,
      sourceDimensions: { width: 512, height: 1024 },
    });
  });

  it.each([
    ["quality", 768, [0.85, 0.85]],
    ["size", 1024, [0.85, 0.7]],
  ] as const)(
    "prioritizes %s when matching target bytes",
    async (priority, width, qualities) => {
      encodedSize = (side, quality) =>
        side <= 768 || (quality !== undefined && quality <= 0.7) ? 1000 : 2000;
      const result = await compressBackgroundImage(
        source,
        info,
        {
          mode: "target",
          format: "webp",
          maxSide: 1024,
          targetBytes: 1000,
          priority,
        },
        new AbortController().signal,
      );
      expect(result).toMatchObject({ width, fits: true, file: { size: 1000 } });
      expect(encodes.map((entry) => entry.quality)).toEqual(qualities);
    },
  );

  it("returns the smallest PNG candidate when the target is unattainable", async () => {
    encodedSize = (side) => side + 1024;
    const result = await compressBackgroundImage(
      source,
      info,
      {
        mode: "target",
        format: "png",
        maxSide: 128,
        targetBytes: 1024,
        priority: "quality",
      },
      new AbortController().signal,
    );
    expect(encodes.map((entry) => [entry.side, entry.quality])).toEqual([
      [128, undefined],
      [96, undefined],
      [72, undefined],
      [64, undefined],
    ]);
    expect(result).toMatchObject({
      width: 64,
      height: 32,
      fits: false,
      file: { size: 1088 },
    });
  });

  it.each([
    [AUTH_BACKGROUND_MAX_BYTES, true],
    [AUTH_BACKGROUND_MAX_BYTES + 1, false],
  ])("checks the final 5 MiB boundary at %i bytes", async (size, fits) => {
    encodedSize = () => size;
    const result = await compressBackgroundImage(
      source,
      info,
      { mode: "manual", format: "png", maxSide: 1024, quality: 85 },
      new AbortController().signal,
    );
    expect(result.fits).toBe(fits);
  });

  it("recognizes APNG and animated WebP and rejects oversized dimensions before decoding", async () => {
    const webp = new Uint8Array(30);
    webp.set(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8X"));
    webp[20] = 2;
    expect(
      await inspectBackgroundImage(new File([webp], "wall.webp")),
    ).toMatchObject({ animated: true, format: "webp" });
    expect(await inspectBackgroundImage(png(800, 600, true))).toMatchObject({
      animated: true,
      format: "png",
    });
    const file = png(10000, 6000);
    const inspected = await inspectBackgroundImage(file);
    expect(inspected.tooManyPixels).toBe(true);
    await expect(
      compressBackgroundImage(
        file,
        inspected,
        { mode: "manual", format: "png", maxSide: 1024, quality: 85 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("5000 万像素");
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects a silently substituted format", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(
      (callback) => callback(new Blob(["png"], { type: "image/png" })),
    );
    await expect(
      compressBackgroundImage(
        source,
        info,
        { mode: "manual", format: "jpeg", maxSide: 1024, quality: 85 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("所选格式");
  });
});
