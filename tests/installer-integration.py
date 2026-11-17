"""Actual release-archive install/restore/network regression. Dedicated directories only.
Run as root with Docker access, never changes application database contents directly.
"""
import argparse,datetime,hashlib,json,os,pathlib,secrets,shutil,socket,sqlite3,subprocess,time,urllib.request
p=argparse.ArgumentParser();p.add_argument('bundle',type=pathlib.Path);p.add_argument('--state-fixture',type=pathlib.Path);p.add_argument('--legacy',action='store_true');args=p.parse_args()
repo=pathlib.Path(__file__).resolve().parents[1];bundle=args.bundle.resolve();stamp=str(int(time.time()));root=repo/'tests/runtime'/('installer-'+stamp);root.mkdir(parents=True);evidence=[];bootstrap=bundle.parent/'install.sh';assert bootstrap.is_file();PUBLIC=urllib.request.build_opener(urllib.request.ProxyHandler({}))

def check(message):
 print('PASS:',message,flush=True);evidence.append({'check':message,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
def run(command,success=True,env=None,preexec=None,timeout=180):
 result=subprocess.run([str(x) for x in command],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,env=env,preexec_fn=preexec,timeout=timeout)
 if (result.returncode==0)!=success:raise AssertionError('Command failed expectation: '+str(command[:3])+'\n'+result.stdout[-5000:])
 return result.stdout
def port(ip='127.0.0.1'):
 with socket.socket(socket.AF_INET6 if ':' in ip else socket.AF_INET) as s:s.bind((ip,0));return s.getsockname()[1]
def origin(ip,port):return 'http://'+('['+ip+']' if ':' in ip else ip)+':'+str(port)
def status(directory):return json.loads(run([directory/'mailweb','status','--json']))
def request(base,path):return json.load(PUBLIC.open(base+'/api/v1'+path,timeout=15))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def dbstate(directory):
 db=sqlite3.connect('file:'+str(directory/'data/db/mail-web.sqlite')+'?mode=ro',uri=True)
 tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
 selected=[n for n in tables if n in ['platform_users','platform_settings','domain_policies','outbound_reservations','client_preferences','native_submissions','operations','mail_services','mail_domains','automatic_gateway_services','automatic_gateway_proofs'] or 'counter' in n]
 result={}
 for table in selected:
  rows=db.execute('SELECT * FROM "'+table+'"').fetchall();result[table]=hashlib.sha256(repr(sorted(rows,key=repr)).encode()).hexdigest()
 db.close();return result

a=root/'installation with spaces';b=root/'ipv6-instance';pa=port();pb=port('::1');namea='mailweb-cli-'+stamp+'-a';nameb='mailweb-cli-'+stamp+'-b';created=[]
# Bootstrap accepts local authenticated/draft assets only via an explicit QA env.
env={**os.environ,'MAIL_WEB_BOOTSTRAP_DIR':str(bundle.parent)}
try:
 run(['bash',bootstrap,'--dir',a,'--container-name',namea,'--bind','127.0.0.1','--port',pa,'--allow-http','--yes','--bundle',bundle],env=env);created.append(a)
 s=status(a);assert s['healthy'] and not s['configured'] and s['port']==pa;assert request(s['accessUrl'],'/installation')['configured'] is False
 check('Actual bootstrap CLI and release image install in a spaced directory; host HTTP, container health and pending web setup are valid')
 key=sha(a/'secrets/session.key');reinstalled=run([a/'mailweb','install','--yes','--bundle',bundle]);assert str(a) in reinstalled;assert sha(a/'secrets/session.key')==key and status(a)['port']==pa
 check('Repeated install preserves generated keys and custom listener without manual configuration')
 run([a/'mailweb','configure','--bind','0.0.0.0','--port',pa,'--allow-http','--yes']);s=status(a);assert s['bind']=='0.0.0.0' and s['healthy'] and '0.0.0.0' not in s['accessUrl'];assert sha(a/'secrets/session.key')==key
 check('Wildcard IPv4 reconfiguration applies the same external port and prints a usable loopback URL')
 run(['bash',bootstrap,'--dir',b,'--name',nameb,'--bind','[::1]:'+str(pb),'--allow-http','--yes','--bundle',bundle],env=env);created.append(b)
 s=status(b);assert s['healthy'] and s['bind']=='::1' and s['accessUrl']==origin('::1',pb)
 check('Legacy name and bracketed IPv6 endpoint flags install a concurrent independent instance')
 bad=root/'occupied-port';sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen();busy=sock.getsockname()[1]
 output=run([a/'mailweb','install','--dir',bad,'--bind','127.0.0.1','--port',busy,'--yes','--bundle',bundle],False);sock.close();assert '占用' in output and not (bad/'.env').exists()
 check('Occupied explicit port fails before installation without taking over another listener')
 output=run([a/'mailweb','install','--dir',root/'foreign','--container-name',namea,'--port',port(),'--yes','--bundle',bundle],False);assert '属于其他安装' in output and status(a)['healthy']
 check('Foreign container ownership is rejected and the first instance remains healthy')
 output=run([a/'mailweb','install','--dir',root/'conflict','--bind','127.0.0.1:19234','--port','19235','--yes','--bundle',bundle],False);assert '冲突' in output and not (root/'conflict').exists()
 check('Conflicting old/new port flags fail before any installation directory is created')
 broken=root/'broken';broken.mkdir();shutil.copy(bundle.parent/'SHA256SUMS',broken/'SHA256SUMS');(broken/bundle.name).write_bytes(bundle.read_bytes()[:500])
 output=run([a/'mailweb','install','--dir',root/'invalid','--port',port(),'--yes','--bundle',broken/bundle.name],False);assert '校验失败' in output and not (root/'invalid/.env').exists()
 check('Corrupt release archive is rejected by checksum before importing an image or writing runtime configuration')
 if args.state_fixture:
  fixture=args.state_fixture.resolve();assert fixture.parts[-2:]==('rebuild','app') or 'restore-checks' in fixture.parts
  run([a/'mailweb','stop']);shutil.copy(fixture/'data/mail.sqlite',a/'data/db/mail-web.sqlite');shutil.copy(fixture/'config/runtime.enc',a/'config/runtime.enc');shutil.copy(fixture/'secrets/session.key',a/'secrets/session.key');run([a/'mailweb','doctor','--fix']);run([a/'mailweb','start'])
  original=dbstate(a);key=sha(a/'secrets/session.key');enc=sha(a/'config/runtime.enc');np=port();neworigin=origin('127.0.0.1',np)
  output=run([a/'mailweb','configure','--bind','127.0.0.1','--port',np,'--yes'],False);assert 'public-origin' in output and status(a)['port']==pa
  run([a/'mailweb','configure','--bind','127.0.0.1','--port',np,'--public-origin',neworigin,'--allow-http','--yes']);assert status(a)['healthy'];assert dbstate(a)==original;assert sha(a/'secrets/session.key')==key;assert sha(a/'config/runtime.enc')!=enc
  token=(a/'secrets/setup.key').read_text().strip();req=urllib.request.Request(neworigin+'/api/v1/installation/config',headers={'Authorization':'Bearer '+token});cfg=json.load(PUBLIC.open(req));assert cfg['settings']['publicOrigin']==neworigin and cfg['settings']['domain']=='example.com'
  check('Populated real isolated snapshot keeps accounts, quota/counters/preferences/submissions; port change requires and applies only website Origin')
  enc=sha(a/'config/runtime.enc');reinstalled=run([a/'mailweb','install','--yes','--bundle',bundle]);assert str(a) in reinstalled;assert sha(a/'config/runtime.enc')==enc and dbstate(a)==original
  check('Reinstall preserves the existing encrypted Stalwart configuration and populated business records')
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as route:
  route.connect(('1.1.1.1',80));hostip=route.getsockname()[0]
 hp=port(hostip);run([a/'mailweb','configure','--bind',hostip,'--port',hp,'--public-origin',origin(hostip,hp),'--allow-http','--yes']);assert status(a)['bind']==hostip and status(a)['healthy']
 check('Specific non-loopback host IPv4 and port mapping are reachable through the configured address')
 before=dbstate(a);key=sha(a/'secrets/session.key');enc=sha(a/'config/runtime.enc') if (a/'config/runtime.enc').exists() else None
 snapshot=pathlib.Path(run([a/'mailweb','backup']).strip().splitlines()[-1]);assert snapshot.is_dir();run([a/'mailweb','restore',snapshot,'--yes']);assert dbstate(a)==before and sha(a/'secrets/session.key')==key
 if enc:assert sha(a/'config/runtime.enc')==enc
 check('Consistent application snapshot restores real SQLite data, encrypted configuration and installation keys; sessions are explicitly revoked')
 if args.state_fixture:
  output=run([a/'mailweb','restore',snapshot,'--port',port(),'--yes'],False);assert 'public-origin' in output and status(a)['healthy'] and dbstate(a)==before
  check('Restore refuses a changed listener without explicit Origin before stopping the existing configured instance')
 run([a/'deploy/mail-web.sh','status']);run([a/'deploy/mail-web.sh','version']);run([a/'mailweb','doctor','--json']);check('Legacy management wrapper, project-local CLI and JSON diagnostics work without depending on current directory')
 # A Docker-authorized non-root process, without changing any host group membership.
 if os.getuid()==0 and pathlib.Path('/home/zero').is_dir():
  normal=root/'normal-user';normal.mkdir();gid=pathlib.Path('/var/run/docker.sock').stat().st_gid;os.chown(normal,1000,gid);normalport=port();normalname='mailweb-cli-'+stamp+'-normal'
  def drop():os.setgroups([]);os.setgid(gid);os.setuid(1000)
  run(['bash',bootstrap,'--dir',normal,'--container-name',normalname,'--bind','127.0.0.1','--port',normalport,'--yes','--bundle',bundle],env={**env,'HOME':'/home/zero','DOCKER_CONFIG':str(normal/'.docker')},preexec=drop);created.append(normal)
  report=json.loads(run([normal/'mailweb','status','--json'],env={**env,'HOME':'/home/zero','DOCKER_CONFIG':str(normal/'.docker')},preexec=drop));assert report['healthy'];uid=run(['docker','inspect','--format','{{.Config.User}}',normalname]).strip();assert uid.startswith('1000:')
  check('Docker-authorized non-root installation runs the application as its non-root owner and can maintain its files')
 # Explicit failure paths must leave infrastructure and unrelated services untouched.
 denied=root/'no-docker';denied.mkdir();os.chown(denied,1000,1000)
 def no_docker():os.setgroups([]);os.setgid(1000);os.setuid(1000)
 denied_cli=root/'no-docker-cli';shutil.copy(a/'bin/mailwebctl',denied_cli);denied_cli.chmod(0o755)
 output=run([denied_cli,'install','--dir',denied,'--yes','--bundle',bundle],False,preexec=no_docker)
 assert 'Docker' in output and not (denied/'.env').exists()
 check('Missing Docker socket permission fails clearly before writing installation configuration')
 downloads=root/'interrupted-download';downloads.mkdir();curl=downloads/'curl'
 curl.write_text('#!/usr/bin/env python3\nimport pathlib,sys,shutil\na=sys.argv[1:];out=pathlib.Path(a[a.index("-o")+1]);url=next(x for x in a if x.startswith("https://"))\nif url.endswith("SHA256SUMS"):shutil.copy('+repr(str(bundle.parent/'SHA256SUMS'))+',out)\nelse:out.write_bytes(b"partial");sys.exit(18)\n')
 curl.chmod(0o755);failed=root/'interrupted-target';faultenv={**os.environ,'PATH':str(downloads)+os.pathsep+os.environ['PATH']};faultenv.pop('MAIL_WEB_BOOTSTRAP_DIR',None)
 run(['bash',bootstrap,'--dir',failed,'--yes'],False,env=faultenv);assert not failed.exists() and status(a)['healthy']
 check('Interrupted bootstrap download stops before extraction or installation and preserves the running instance')
 corrupt=snapshot/'mail-web.sqlite';saved=corrupt.read_bytes();corrupt.write_bytes(saved+b'corrupt')
 try:
  output=run([a/'mailweb','restore',snapshot,'--yes'],False);assert '校验失败' in output and status(a)['healthy'] and dbstate(a)==before
 finally:corrupt.write_bytes(saved)
 check('Corrupted snapshot is refused before stopping or replacing the healthy application')
 run([a/'mailweb','logs','--tail','2'])
 check('Native log command reads the application file logs with the container logging driver disabled')
 # A backup error must resume the old program before an upgrade can touch data.
 backupfault=root/'fail-backup';backupfault.mkdir();backupmarker=backupfault/'fail-once';backupmarker.write_text('fail');real_docker=shutil.which('docker');backupwrapper=backupfault/'docker'
 backupwrapper.write_text('#!/usr/bin/env python3\nimport os,pathlib,sys\nm=pathlib.Path('+repr(str(backupmarker))+')\nif "--backup" in sys.argv and m.exists():m.unlink();print("Injected isolated backup failure",file=sys.stderr);sys.exit(42)\nos.execv('+repr(real_docker)+',["docker",*sys.argv[1:]])\n');backupwrapper.chmod(0o755)
 run([a/'mailweb','update','--yes','--bundle',bundle],False,env={**os.environ,'PATH':str(backupfault)+os.pathsep+os.environ['PATH']});assert status(a)['healthy'] and dbstate(a)==before
 check('Backup failure prevents upgrade and automatically resumes the unchanged original instance')
 # Simulate an actual startup failure after download/checksum/backup, then restore.
 faults=root/'fail-start';faults.mkdir();marker=faults/'fail-once';marker.write_text('fail');real_docker=shutil.which('docker');wrapped=faults/'docker'
 wrapped.write_text('#!/usr/bin/env python3\nimport os,pathlib,sys\nm=pathlib.Path('+repr(str(marker))+')\nif "compose" in sys.argv and "up" in sys.argv and m.exists():m.unlink();print("Injected isolated startup failure",file=sys.stderr);sys.exit(42)\nos.execv('+repr(real_docker)+',["docker",*sys.argv[1:]])\n');wrapped.chmod(0o755)
 existing_snapshots=set((a/'backups').iterdir());output=run([a/'mailweb','update','--yes','--bundle',bundle],False,env={**os.environ,'PATH':str(faults)+os.pathsep+os.environ['PATH']});assert 'restore' in output and not status(a)['running']
 recovery=list(set((a/'backups').iterdir())-existing_snapshots);recovery=[x for x in recovery if x.is_dir() and (x/'SHA256SUMS').exists()];assert len(recovery)==1
 run([a/'mailweb','restore',recovery[0],'--yes']);assert status(a)['healthy'] and dbstate(a)==before and sha(a/'secrets/session.key')==key
 check('Startup failure after a verified update returns nonzero, retains a matching snapshot and restores with its reported command without database downgrade')
 if args.legacy:
  legacy=root/'legacy-shell';(legacy/'deploy').mkdir(parents=True);shutil.copy(repo/'tests/fixtures/legacy-mail-web.sh',legacy/'deploy/mail-web.sh');lp=port();ln='mailweb-cli-'+stamp+'-legacy'
  bounded=legacy/'bounded-download';bounded.mkdir();realcurl=shutil.which('curl');(bounded/'curl').write_text('#!/bin/sh\nexec '+realcurl+' --ipv4 --connect-timeout 10 --max-time 60 --retry 2 "$@"\n');(bounded/'curl').chmod(0o700)
  oldenv={**os.environ,'PATH':str(bounded)+os.pathsep+os.environ['PATH'],'MAIL_WEB_CONTAINER_NAME':ln,'MAIL_WEB_LISTEN_ADDRESS':'127.0.0.1','MAIL_WEB_PORT':str(lp),'MAIL_WEB_REPOSITORY':'reina0721/webmail'}
  run(['sh',legacy/'deploy/mail-web.sh','install','v0.3.0-alpha.2'],env=oldenv,timeout=600)
  oldkey=sha(legacy/'secrets/session.key')
  try:
   run(['bash',bootstrap,'--dir',legacy,'--yes','--bundle',bundle],env=env);created.append(legacy)
   ls=status(legacy);assert ls['healthy'] and ls['container']==ln and ls['port']==lp and ls['version']=='v0.4.0-alpha.2';assert sha(legacy/'secrets/session.key')==oldkey
   run([legacy/'deploy/mail-web.sh','status']);check('Actual v0.3.0-alpha.2 Release and legacy shell installation upgrade to Rust management and new schema without resetting custom infrastructure or session key')
  finally:
   if (legacy/'mailweb').exists():run([legacy/'mailweb','stop'])
   else:run(['sh',legacy/'deploy/mail-web.sh','stop'])
 result={'scope':'local disposable Docker installations; actual release archives; not public production','passed':True,'checks':evidence,'directory':str(root),'at':datetime.datetime.now(datetime.timezone.utc).isoformat()};(root/'report.json').write_text(json.dumps(result,indent=2));print('REPORT',root/'report.json',flush=True)
finally:
 for directory in created:
  try:
   run([directory/'mailweb','stop'])
   run(['docker','compose','--project-directory',directory,'--env-file',directory/'.env','-f',directory/'compose.yaml','down'])
  except Exception as error:print('Cleanup stop:',str(error)[:300],flush=True)
