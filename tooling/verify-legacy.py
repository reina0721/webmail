"""Run the legacy integration suite from a fresh disposable fixture set.
Preserve prior fixtures as a stopped snapshot; never delete data or select other containers.
"""
import json,os,pathlib,shutil,subprocess,time
root=pathlib.Path(__file__).resolve().parents[1];runtime=root/'tests/runtime'
names=['mail-web-app-test','mail-web-auto-test','mail-web-connections-test','mail-web-setup-test','mail-web-stalwart-secondary-test','mail-web-stalwart-test']
known={v['Name'].lstrip('/'):v for v in json.loads(subprocess.check_output(['docker','inspect',*names],stderr=subprocess.DEVNULL,text=True))} if subprocess.run(['docker','inspect',*names],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0 else {}
# Even a partial earlier run is safe to archive: inspect each exact fixture name.
if not known:
 for name in names:
  result=subprocess.run(['docker','inspect',name],capture_output=True,text=True)
  if result.returncode==0:known[name]=json.loads(result.stdout)[0]
for name,container in known.items():
 mounts=[m for m in container.get('Mounts',[]) if m.get('Type')=='bind']
 assert mounts and all(m['Source'].startswith(str(runtime)+'/') or not m.get('RW') and m['Source'].startswith(str(root)+'/') for m in mounts), 'Refusing an unexpected container mount: '+name
if known:
 subprocess.run(['docker','stop',*known],check=True,stdout=subprocess.DEVNULL)
archive=runtime/'legacy-snapshots'/str(time.time_ns());archive.mkdir(parents=True,mode=0o700)
for item in list(runtime.iterdir()):
 if item.name not in ['rebuild','legacy-snapshots']:shutil.move(str(item),archive/item.name)
if known:subprocess.run(['docker','rm',*known],check=True,stdout=subprocess.DEVNULL)
env={**os.environ,'MAIL_WEB_TEST_IMAGE':os.environ.get('MAIL_WEB_TEST_IMAGE','mail-web:rebuild')}
result=subprocess.run(['sh','tests/run-integration.sh'],cwd=root,env=env)
report={'scope':'local disposable legacy integration fixtures','passed':result.returncode==0,'previousFixtureSnapshot':str(archive),'managedContainers':names}
(runtime/'legacy-integration-report.json').write_text(json.dumps(report,indent=2))
raise SystemExit(result.returncode)
