import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = join(import.meta.dirname, "..");
const dependency = dirname(
  createRequire(import.meta.url).resolve("@jsquash/webp/encode.js"),
);
const output = join(root, "public", "background-webp");

await mkdir(output, { recursive: true });
await Promise.all([
  build({
    entryPoints: [join(root, "src/lib/auth-background-webp-worker.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile: join(output, "encoder.js"),
    minify: true,
    legalComments: "eof",
  }),
  copyFile(
    join(dependency, "codec/enc/webp_enc.wasm"),
    join(output, "webp_enc.wasm"),
  ),
  copyFile(
    join(dependency, "codec/enc/webp_enc_simd.wasm"),
    join(output, "webp_enc_simd.wasm"),
  ),
  copyFile(join(dependency, "LICENSE"), join(output, "LICENSE")),
  copyFile(
    join(dependency, "codec/LICENSE.codec.md"),
    join(output, "LICENSE.codec.md"),
  ),
]);
