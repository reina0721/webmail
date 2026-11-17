// Enumerate this exact static export for the upstream encrypted-offline shell.
import {readdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.join(import.meta.dirname,'out');
const buildId=await readFile(path.join(import.meta.dirname,'.next/BUILD_ID'),'utf8');
const files=[];
async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())await walk(p);else if(p.includes('/_next/static/'))files.push('/'+path.relative(root,p));}}
await walk(root);
await writeFile(path.join(root,'offline-shell.json'),JSON.stringify({buildId,files}));
await writeFile(path.join(root,'build.json'),JSON.stringify({buildId,revision:process.env.MAIL_WEB_REVISION||'development',version:(await readFile(path.join(import.meta.dirname,'../../../release-version.txt'),'utf8').catch(()=> '0.4.0-alpha.1')).trim()}));
