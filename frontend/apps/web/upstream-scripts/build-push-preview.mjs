// Reuse Bulwark's pure preview formatter in the classic service worker.
import {build} from 'esbuild';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await build({entryPoints:[path.join(root,'src/lib/clean-preview.ts')],bundle:true,format:'iife',globalName:'MailWebPushUtils',platform:'browser',target:'es2022',outfile:path.join(root,'public/push-preview-utils.js'),minify:true,legalComments:'inline'});
