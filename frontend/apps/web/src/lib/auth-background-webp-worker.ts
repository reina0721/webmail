import encode, { init } from "@jsquash/webp/encode.js";

let ready: ReturnType<typeof init> | undefined;

self.addEventListener(
  "message",
  async (event: MessageEvent<{ pixels: ImageData; quality: number }>) => {
    try {
      ready ??= init({
        locateFile: (name: string) => new URL(name, self.location.href).href,
      });
      await ready;
      const { pixels, quality } = event.data;
      const result = await encode(pixels, { quality, lossless: 0 });
      self.postMessage(result, { transfer: [result] });
    } catch {
      self.postMessage(null);
    }
  },
);
