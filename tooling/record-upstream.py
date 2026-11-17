"""Record reviewable changes against the existing, pinned upstream checkout."""
import pathlib,json,hashlib,difflib,sys
root=pathlib.Path(__file__).resolve().parents[1];source=root/'.cache/bulwark-src'
manifest=json.loads((root/'docs/upstream/bulwark-manifest.json').read_text());changes=[];patch=[]
for entry in manifest['files']:
 local=root/entry['local'];data=local.read_bytes();sha=hashlib.sha256(data).hexdigest()
 if sha==entry['sha256']:continue
 baseline=source/entry['upstream']
 assert hashlib.sha256(baseline.read_bytes()).hexdigest()==entry['sha256'],baseline
 changes.append({'local':entry['local'],'upstream':entry['upstream'],'sha256':sha})
 try:patch.extend(difflib.unified_diff(baseline.read_text().splitlines(True),data.decode().splitlines(True),fromfile='a/'+entry['upstream'],tofile='b/'+entry['local']))
 except UnicodeDecodeError:patch.append('Binary adaptation: '+entry['local']+'\n')
(root/'docs/upstream/bulwark-adaptations.json').write_text(json.dumps({'commit':manifest['commit'],'files':changes},indent=2)+'\n')
(root/'docs/upstream/bulwark.patch').write_text(''.join(patch))
print(len(changes),'adaptations recorded')
