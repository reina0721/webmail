"""Run each integration client from its own real IP in the isolated Docker network.
Preserves production rate limits instead of relaxing them for tests.
"""
import fcntl,ipaddress,json,os,pathlib,secrets,subprocess,sys,time,urllib.request
root=pathlib.Path(__file__).resolve().parents[1];settings=json.loads((root/'tests/runtime/rebuild/settings.json').read_text())
# Deployment and environment-mutating regressions share one lifetime lock.
# A caller already holding it (the one-command verifier) lends that lock.
if os.environ.get('MAIL_WEB_TEST_DEPLOY_LOCK')!='1':
    stack_lock=(root/'tests/runtime/rebuild/lock').open('a')
    try:fcntl.flock(stack_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        print('Waiting for the isolated test environment lock...',flush=True)
        fcntl.flock(stack_lock,fcntl.LOCK_EX)
network=json.loads(subprocess.check_output(['docker','network','inspect','mailweb-rebuild_default'],text=True))[0]
from test_network import select_actor_ip
used={value['IPv4Address'].split('/')[0] for value in network['Containers'].values() if value.get('IPv4Address')}
# Stopped containers release their IPs, but persisted production rate buckets
# remain. Never reuse an actor address during this test network's lifetime.
registry=root/'tests/runtime/rebuild/actor-addresses.json'
previous=json.loads(registry.read_text()) if registry.exists() else {}
reserved=previous.get('addresses',[]) if previous.get('networkId')==network['Id'] else []
ip=select_actor_ip(network['IPAM']['Config'][0]['Subnet'],used|set(reserved))
registry.write_text(json.dumps({'networkId':network['Id'],'addresses':[*reserved,ip]})+'\n');registry.chmod(0o600)
args=sys.argv[1:];suite='tests/rebuild-integration.py'
if '--native' in args:suite='tests/native-client-integration.py';args.remove('--native')
if '--push' in args:suite='tests/push-integration.py';args.remove('--push')
if '--gateway' in args:suite='tests/gateway-integration.py';args.remove('--gateway')
if '--pim' in args:suite='tests/pim-details-integration.py';args.remove('--pim')
if '--browser-fixtures' in args:suite='tests/browser-fixtures.py';args.remove('--browser-fixtures')
cmd=['docker','run','--rm','--label','mailweb.test.actor='+('soak' if '--soak' in args else pathlib.Path(suite).stem),'--network','mailweb-rebuild_default','--ip',ip,'-v',f'{root}:{root}','-v','/var/run/docker.sock:/var/run/docker.sock','-v','/usr/bin/docker:/usr/bin/docker:ro','-v','/usr/libexec/docker/cli-plugins:/usr/libexec/docker/cli-plugins:ro','-w',str(root),'-e','MAIL_WEB_TEST_BASE='+settings['origin'],'-e','MAIL_WEB_TEST_MAILPIT=http://mailpit:8025','python:3.13-slim-bookworm','python3','-u',suite,'tests/runtime/rebuild',*args]
def running_build():
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:'+str(settings['port'])+'/build.json',timeout=10) as response:return json.load(response)
soaking='--soak' in args
if soaking:before_build=running_build();soak_start=time.monotonic()
result=subprocess.call(cmd)
if result==0 and soaking:
    after_build=running_build();elapsed=time.monotonic()-soak_start
    evidence=json.loads((root/'tests/runtime/rebuild/soak-report.json').read_text())
    rounds=[e for e in evidence if e['check'].startswith('Sustained signup/login after ')]
    assert elapsed>=1800 and len(rounds)==4 and before_build==after_build,'Incomplete or changed-build soak'
    proof=root/'tests/runtime/rebuild/soak-build-report.json'
    proof.write_text(json.dumps({'passed':True,'elapsedSeconds':elapsed,'successfulRegistrations':len(rounds),'beforeBuild':before_build,'afterBuild':after_build},indent=2)+'\n')
    # The formal one-command workflow reaches this only after quality,
    # service regressions, old-data migration and independent restore passed.
    if os.environ.get('MAIL_WEB_TEST_DEPLOY_LOCK')=='1':
        result=subprocess.call([sys.executable,str(root/'tooling/check-release.py'),'--record-verified-soak',str(proof)])
if result==0 and suite=='tests/native-client-integration.py':
    # The outer deployment or this actor owns the environment lock. A host
    # helper temporarily injects response loss AFTER official acceptance and
    # always restores the original Compose app before the next suite starts.
    result=subprocess.call([sys.executable,str(root/'tooling/verify-native-response-loss.py')],env={**os.environ,'MAIL_WEB_TEST_DEPLOY_LOCK':'1'})
raise SystemExit(result)
