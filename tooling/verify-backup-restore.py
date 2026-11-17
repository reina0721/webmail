"""Restore an isolated copy of this test stack and operate its real mailboxes.
Only the two named test projects are managed. No runtime configuration is edited.
"""
import contextlib,json,os,pathlib,shutil,socket,subprocess,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[1];runtime=ROOT/'tests/runtime/rebuild'
sys.argv=[sys.argv[0],str(runtime)];sys.path.insert(0,str(ROOT/'tests'));import environment_client as env
base_file=ROOT/'deploy/compose.test.yaml';project='mailweb-rebuild';stamp=str(int(time.time()));restored=runtime/'restore-checks'/stamp;restore_project='mailweb-restore-'+stamp

def run(*cmd,**kw):return subprocess.run(cmd,check=True,**kw)
def compose(name,envfile,*args,override=None):
 cmd=['docker','compose','--project-name',name,'--env-file',str(envfile),'-f',str(base_file)]
 if override:cmd+=['-f',str(override)]
 return run(*cmd,*args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True).stdout
@contextlib.contextmanager
def free_ports(count):
 sockets=[]
 try:
  for _ in range(count):
   s=socket.socket();s.bind(('127.0.0.1',0));sockets.append(s)
  yield [s.getsockname()[1] for s in sockets]
 finally:
  for s in sockets:s.close()

def snapshot_state(operator,alice):
 return {'users':sorted(u['email'] for u in env.req('/admin/users',c=operator)['items']),
         'policy':env.req('/admin/registration',c=operator)['policy'],
         'defaults':env.req('/admin/client-policy',c=operator),
         'preferences':env.req('/client/preferences',c=alice),
         'contacts':sorted(n['id'] for n in env.jmap(alice,'ContactCard/get')['list']),
         'calendars':sorted(n['id'] for n in env.jmap(alice,'Calendar/get')['list']),
         'files':sorted(n['id'] for n in env.jmap(alice,'FileNode/get')['list']),
         'usage':env.req('/account/usage',c=alice)}

assert not subprocess.check_output(['docker','ps','-q','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service=web'],text=True).strip(),'Use the production test build before restore verification.'
operator=env.login(env.D['operator'],env.D['operatorPassword']);alice=env.login(env.D['user'],env.D['userPassword'])
original_env=runtime/'compose.env';baseline=snapshot_state(operator,alice);restored.mkdir(parents=True,mode=0o700)
backup='/runtime/data/verified-backup-'+stamp+'.sqlite'
compose(project,original_env,'exec','-T','app','/app/mail-web','--backup',backup)
try:
 # Stop only this disposable stack so the mail store and platform snapshot have a coherent boundary.
 compose(project,original_env,'stop','app','stalwart-a','stalwart-b','mailpit')
 for name in ['app','stalwart-a','stalwart-b','mailpit']:run('cp','-a',str(runtime/name),str(restored/name))
 # Use the app's online SQLite backup rather than a byte copy of an open database.
 shutil.copy2(runtime/'app/data'/pathlib.Path(backup).name,restored/'app/data/mail.sqlite')
 for suffix in ['-wal','-shm']:(restored/('app/data/mail.sqlite'+suffix)).unlink(missing_ok=True)
finally:compose(project,original_env,'up','-d','--wait','--wait-timeout','180')
original=original_env.read_text();old='MAIL_WEB_TEST_ROOT='+str(runtime)
assert original.splitlines().count(old)==1,'Unexpected test volume path; refusing to restore'
text=original.replace(old,'MAIL_WEB_TEST_ROOT='+str(restored),1)
(restored/'compose.env').write_text(text);(restored/'compose.env').chmod(0o600)
with free_ports(4) as ports:
 port,a,b,mail=ports
 override=restored/'ports.yaml'
 override.write_text('services:\n'+''.join('  '+name+':\n    ports: !override ["127.0.0.1:'+str(host)+':'+str(container)+'"]\n' for name,host,container in [('app',port,env.D['port']),('stalwart-a',a,8080),('stalwart-b',b,8080),('mailpit',mail,8025)]))
# Ports are released immediately before Compose binds them. Retry a collision as a test failure.
try:
 compose(restore_project,restored/'compose.env','up','-d','--wait','--wait-timeout','180',override=override)
 env.BASE='http://127.0.0.1:'+str(port);env.MAIL='http://127.0.0.1:'+str(mail);env.PUBLIC=env.client()
 # Sessions exist in the consistent snapshot too. Reuse those exact cookie
 # sessions to verify restoration, instead of spending the copied production
 # login rate-limit budget repeatedly on the same two fixture accounts.
 assert snapshot_state(operator,alice)==baseline,'Restored mailbox, policy, preferences, quota or account state differs from its snapshot'
 assert env.req('/auth/session',c=operator)['email']==env.D['operator']
 # Real authenticated JMAP against each restored Stalwart, not only an SQLite integrity check.
 domains=env.req('/installation/connections',c=operator)['domains'];second=next(d['id'] for d in domains if d['name']=='second.example.com')
 users=env.req('/admin/users?domainId='+second,c=operator)['items'];candidate=next(u for u in users if not u['operator'])
 secondary=env.login(candidate['email'],env.D['userPassword']);assert env.req('/jmap/session',c=secondary)['platformAccountId'];assert env.jmap(secondary,'Mailbox/get')['list']
 report={'scope':'local isolated Docker restore, not public production','project':restore_project,'passed':True,'checks':['consistent online SQLite backup','separate restored mail stores and network','real primary and second-server login/JMAP','accounts, registration strategy, defaults, preferences, PIM IDs and quota match snapshot'],'at':stamp}
 (runtime/'backup-restore-report.json').write_text(json.dumps(report,indent=2));print('PASS: independent backup restore preserves both real mail services and application state',flush=True)
 # Negative keys run only after the original snapshot assertions, in this
 # independent restored environment. They never change the primary test app.
 from turnstile_cases import verify as verify_turnstile
 verify_turnstile(env,operator)
 guard=restored/'production-guard.yaml'
 guard.write_text(override.read_text().replace('  app:\n','  app:\n    environment:\n      MAIL_WEB_TEST_MODE: \"false\"\n',1))
 compose(restore_project,restored/'compose.env','up','-d','--no-deps','--wait','--wait-timeout','180','app',override=guard)
 env.wait()
 from turnstile_cases import verify_production_guard
 verify_production_guard(env)
finally:
 compose(restore_project,restored/'compose.env','down',override=override)
