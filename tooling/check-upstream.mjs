/** Verify the pinned import and explicitly recorded host adaptations. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/upstream/bulwark-manifest.json'),'utf8'));
const changes=JSON.parse(fs.readFileSync(path.join(root,'docs/upstream/bulwark-adaptations.json'),'utf8'));
const adapted=new Map(changes.files.map(file=>[file.local,file.sha256]));
const failures=[];
for(const entry of manifest.files){
 const local=path.join(root,entry.local);
 if(!fs.existsSync(local)){failures.push('Missing: '+entry.local);continue;}
 const actual=crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
 if(actual!==(adapted.get(entry.local)??entry.sha256))failures.push('Unrecorded change: '+entry.local);
}
if(manifest.commit!=='7cdedb60cc157cfeaf19623732b1135da6d3dc28')failures.push('Unapproved upstream baseline');
if(failures.length)throw Error(failures.join('\n'));
console.log(`Verified ${manifest.files.length} pinned Bulwark files; ${adapted.size} recorded host adaptations.`);
