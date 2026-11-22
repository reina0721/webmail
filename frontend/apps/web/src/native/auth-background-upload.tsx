"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Action,
  ConsoleStatusBanner,
  FileField,
  SelectField,
  SliderField,
  TextField,
} from "@mail-web/ui";
import { errorMessage } from "@platform/lib/api";
import {
  AUTH_BACKGROUND_FORMATS,
  AUTH_BACKGROUND_MAX_BYTES,
  BackgroundImageError,
  compressBackgroundImage,
  inspectBackgroundImage,
  type BackgroundCompressionResult,
  type BackgroundFormat,
  type BackgroundImageInfo,
} from "@/lib/auth-background-image";
import type { ImageDimensions } from "@/lib/image-size";

type Mode = "original" | "manual" | "target";
const modes = [
  { value: "original", label: "原图上传" },
  { value: "manual", label: "手动压缩" },
  { value: "target", label: "按目标体积压缩" },
];
const formats = [
  { value: "jpeg", label: "JPEG（有损，透明处填白）" },
  { value: "webp", label: "WebP（有损，保留透明）" },
  { value: "png", label: "PNG（无损编码，保留透明）" },
];
const priorities = [
  { value: "quality", label: "优先画质" },
  { value: "size", label: "优先尺寸" },
];

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;
}

function ImagePreview({
  file,
  mime,
  label,
  format,
  dimensions,
  showImage = true,
}: {
  file: File;
  mime: string;
  label: string;
  format: string;
  dimensions?: ImageDimensions;
  showImage?: boolean;
}) {
  const [preview, setPreview] = useState<{ file: File; url: string }>();
  const [measured, setMeasured] = useState<{
    file: File;
    size: ImageDimensions;
  }>();
  useEffect(() => {
    if (!showImage) return;
    const url = URL.createObjectURL(
      file.type === mime ? file : file.slice(0, file.size, mime),
    );
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, mime, showImage]);
  const size = measured?.file === file ? measured.size : dimensions;
  return (
    <figure className="console-bg-image-result">
      {showImage && preview?.file === file && (
        <img
          src={preview.url}
          alt={label}
          onLoad={(e) =>
            setMeasured({
              file,
              size: {
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              },
            })
          }
        />
      )}
      <figcaption>
        <strong>{label}</strong>
        <span className="muted">
          {format} · {size && `${size.width} × ${size.height} px · `}
          {formatBytes(file.size)}
        </span>
      </figcaption>
    </figure>
  );
}

export function AuthBackgroundUpload({
  disabled,
  onUpload,
  children,
}: {
  disabled: boolean;
  onUpload: (file: File) => Promise<boolean>;
  children?: ReactNode;
}) {
  const [selection, setSelection] = useState<{
    file: File;
    info?: BackgroundImageInfo;
  }>();
  const [mode, setMode] = useState<Mode>("original");
  const [format, setFormat] = useState<BackgroundFormat>("webp");
  const [priority, setPriority] = useState<"quality" | "size">("quality");
  const [quality, setQuality] = useState(85);
  const [maxSide, setMaxSide] = useState("2560");
  const [target, setTarget] = useState("512");
  const [result, setResult] = useState<BackgroundCompressionResult>();
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef<AbortController | null>(null);
  const inspection = useRef<AbortController | null>(null);
  const uploadLock = useRef(false);

  useEffect(
    () => () => {
      generation.current?.abort();
      inspection.current?.abort();
    },
    [],
  );

  function invalidate() {
    setResult(undefined);
    setError("");
  }

  function clear() {
    generation.current?.abort();
    generation.current = null;
    inspection.current?.abort();
    setGenerating(false);
    setSelection(undefined);
    invalidate();
  }

  async function selectFile(file: File) {
    clear();
    const job = new AbortController();
    inspection.current = job;
    setMode("original");
    setSelection({ file });
    try {
      const info = await inspectBackgroundImage(file);
      if (!job.signal.aborted) setSelection({ file, info });
    } catch (e) {
      if (!job.signal.aborted) {
        setSelection(undefined);
        setError(
          e instanceof BackgroundImageError
            ? e.message
            : "无法读取图片，请重新选择文件。",
        );
      }
    }
  }

  const info = selection?.info;
  const originalOnly =
    info?.format === "svg" ||
    info?.animated ||
    info?.tooManyPixels ||
    !info?.dimensions;
  const side = Number(maxSide);
  const targetKiB = Number(target);
  const validSide = Number.isInteger(side) && side >= 64 && side <= 4096;
  const validTarget =
    Number.isInteger(targetKiB) && targetKiB >= 1 && targetKiB <= 5120;
  const candidate =
    mode === "original"
      ? selection?.file
      : result?.fits
        ? result.file
        : undefined;
  const originalOversize =
    mode === "original" &&
    !!candidate &&
    candidate.size > AUTH_BACKGROUND_MAX_BYTES;

  async function generate() {
    if (
      !selection?.info ||
      generation.current ||
      disabled ||
      mode === "original" ||
      originalOnly ||
      !validSide ||
      (mode === "target" && !validTarget)
    )
      return;
    const job = new AbortController();
    generation.current = job;
    setGenerating(true);
    invalidate();
    try {
      const preview = await compressBackgroundImage(
        selection.file,
        selection.info,
        mode === "manual"
          ? { mode, format, maxSide: side, quality }
          : {
              mode,
              format,
              maxSide: side,
              targetBytes: targetKiB * 1024,
              priority,
            },
        job.signal,
      );
      if (!job.signal.aborted) setResult(preview);
    } catch (e) {
      if (!job.signal.aborted) {
        setError(
          e instanceof BackgroundImageError
            ? e.message
            : "无法生成压缩预览，请重试或更换格式。",
        );
      }
    } finally {
      if (generation.current === job) {
        generation.current = null;
        setGenerating(false);
      }
    }
  }

  async function upload() {
    if (
      !info ||
      !candidate ||
      candidate.size > AUTH_BACKGROUND_MAX_BYTES ||
      disabled ||
      generating ||
      uploadLock.current
    )
      return;
    uploadLock.current = true;
    setUploading(true);
    setError("");
    try {
      if (await onUpload(candidate)) clear();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  }

  return (
    <>
      <div className="console-actions">
        <FileField
          label={selection ? "更换图片" : "选择图片"}
          accept="image/jpeg,image/png,image/webp,image/svg+xml,.jpg,.jpeg,.png,.apng,.webp,.svg"
          disabled={disabled || uploading}
          onFile={(file) => void selectFile(file)}
        />
        {!selection && children}
      </div>
      {selection && !info && (
        <div className="console-actions">
          <p role="status">正在读取图片…</p>
          <Action variant="quiet" onPress={clear}>
            取消
          </Action>
        </div>
      )}
      {selection && info && (
        <>
          <div className="console-form-grid">
            <SelectField
              label="压缩方式"
              value={mode}
              options={originalOnly ? modes.slice(0, 1) : modes}
              disabled={disabled || uploading || generating || originalOnly}
              onValueChange={(value) => {
                setMode(value as Mode);
                invalidate();
              }}
            />
            {mode !== "original" && (
              <>
                <SelectField
                  label="压缩算法"
                  value={format}
                  options={formats}
                  disabled={disabled || uploading || generating}
                  onValueChange={(value) => {
                    setFormat(value as BackgroundFormat);
                    invalidate();
                  }}
                />
                <TextField
                  label="最长边（px）"
                  type="number"
                  value={maxSide}
                  disabled={disabled || uploading || generating}
                  error={validSide ? undefined : "请输入 64–4096 的整数。"}
                  slotProps={{ htmlInput: { min: 64, max: 4096, step: 1 } }}
                  onChange={(e) => {
                    setMaxSide(e.target.value);
                    invalidate();
                  }}
                />
                {mode === "manual" && format !== "png" && (
                  <SliderField
                    label="画质"
                    value={quality}
                    min={1}
                    max={100}
                    unit="%"
                    disabled={disabled || uploading || generating}
                    onChange={(value) => {
                      setQuality(value);
                      invalidate();
                    }}
                  />
                )}
                {mode === "target" && (
                  <>
                    <TextField
                      label="目标体积（KiB）"
                      type="number"
                      value={target}
                      disabled={disabled || uploading || generating}
                      error={validTarget ? undefined : "请输入 1–5120 的整数。"}
                      slotProps={{ htmlInput: { min: 1, max: 5120, step: 1 } }}
                      onChange={(e) => {
                        setTarget(e.target.value);
                        invalidate();
                      }}
                    />
                    {format !== "png" && (
                      <SelectField
                        label="压缩优先级"
                        value={priority}
                        options={priorities}
                        disabled={disabled || uploading || generating}
                        onValueChange={(value) => {
                          setPriority(value as "quality" | "size");
                          invalidate();
                        }}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </div>
          {originalOnly && (
            <p className="console-hint">
              {info.tooManyPixels
                ? "图片超过 5000 万像素，仅支持原图上传。"
                : info.format === "svg" || info.animated
                  ? "SVG 和动态图仅支持原图上传。"
                  : "无法读取图片尺寸，仅支持原图上传。"}
            </p>
          )}
          <div className="console-form-grid console-bg-image-previews">
            <ImagePreview
              key="original"
              file={selection.file}
              mime={
                info.format === "svg"
                  ? "image/svg+xml"
                  : AUTH_BACKGROUND_FORMATS[info.format].mime
              }
              format={
                info.format === "svg"
                  ? "SVG"
                  : info.animated && info.format === "png"
                    ? "APNG"
                    : AUTH_BACKGROUND_FORMATS[info.format].label
              }
              label="原图"
              dimensions={result?.sourceDimensions ?? info.dimensions}
              showImage={
                !info.tooManyPixels &&
                (info.format === "svg" || !!info.dimensions)
              }
            />
            {result && (
              <ImagePreview
                key="compressed"
                file={result.file}
                mime={result.file.type}
                format={AUTH_BACKGROUND_FORMATS[format].label}
                label="压缩预览"
                dimensions={result}
              />
            )}
          </div>
          {originalOversize && (
            <ConsoleStatusBanner severity="warning" role="alert">
              原图超过上传上限（5 MiB）。
              {!originalOnly && "请选择一种压缩方式。"}
            </ConsoleStatusBanner>
          )}
          {result && !result.fits && (
            <ConsoleStatusBanner severity="warning" role="alert">
              {mode === "target"
                ? "未达到目标体积，请提高目标体积或调整格式。"
                : "压缩结果超过 5 MiB，请缩小最长边或调整压缩参数。"}
            </ConsoleStatusBanner>
          )}
          <div className="console-actions">
            {mode !== "original" && (
              <Action
                variant="secondary"
                loading={generating}
                disabled={
                  disabled ||
                  uploading ||
                  !validSide ||
                  (mode === "target" && !validTarget)
                }
                onPress={() => void generate()}
              >
                {generating ? "正在压缩…" : "生成预览"}
              </Action>
            )}
            <Action
              disabled={
                disabled || generating || !candidate || originalOversize
              }
              loading={uploading}
              onPress={() => void upload()}
            >
              {uploading ? "上传中…" : "确认上传"}
            </Action>
            <Action variant="quiet" disabled={uploading} onPress={clear}>
              取消
            </Action>
          </div>
        </>
      )}
      {error && (
        <ConsoleStatusBanner severity="error" role="alert">
          {error}
        </ConsoleStatusBanner>
      )}
    </>
  );
}
