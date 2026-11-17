import {readFile,readdir} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';

// Integration check against the production export, so an omitted stylesheet
// cannot leave apparently configured recipes with no executable keyframes.
test('production CSS includes the keyframes consumed by application recipes',async()=>{
 const root=new URL('../',import.meta.url);
 const chunkDir=new URL('frontend/apps/web/out/_next/static/chunks/',root);
 const files=(await readdir(chunkDir)).filter(name=>name.endsWith('.css'));
 assert.ok(files.length,'Build the production export before running this check');
 const css=(await Promise.all(files.map(name=>readFile(new URL(name,chunkDir),'utf8')))).join('\n');
 const defined=new Set([...css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)].map(match=>match[1]));
 const recipes=await readFile(new URL('frontend/packages/material-ui/src/client.css',root),'utf8');
 assert.ok(/animation:\s*content-enter/.test(recipes),'Expected the new content transition recipe');
 assert.ok(defined.has('content-enter'),'Missing executable content-enter keyframes');
 assert.ok(css.includes('prefers-reduced-motion'),'Production styles must honor reduced motion');
 assert.ok(!css.includes('heroui'),'Retired vendor styles must not enter the new bundle');
});
