"""Real accepted-response loss against official Stalwart, with automatic restoration.

Only the isolated Compose app gets a temporary hosts entry. No DB edits,
production containers, upstream modifications or private credentials in output.
Run with Docker access after test-env.sh up, outside another mutating regression.
"""
import fcntl,http.cookiejar,json,os,pathlib,subprocess,sys,time,urllib.request,uuid

project=pathlib.Path(__file__).resolve().parents[1]
root=project/'tests/runtime/rebuild'
if os.environ.get('MAIL_WEB_TEST_DEPLOY_LOCK')!='1':
    stack_lock=(root/'lock').open('a')
    fcntl.flock(stack_lock,fcntl.LOCK_EX)
sys.argv=[sys.argv[0],str(root)]
sys.path.insert(0,str(project/'tests'))
from environment_client import *

name='mailweb-native-response-loss-proxy'
marker=root/'native-response-loss.marker'
override=root/'native-response-loss.compose.json'
report=root/'native-response-loss-report.json'
def docker(*args):return subprocess.check_output(['docker',*args],text=True).strip()
def ip(container):
    return json.loads(docker('inspect',container))[0]['NetworkSettings']['Networks']['mailweb-rebuild_default']['IPAddress']
def app_compose(extra=False):
    args=['docker','compose','--project-name','mailweb-rebuild','--env-file',str(root/'compose.env'),'-f',str(project/'deploy/compose.test.yaml')]
    if extra:args+=['-f',str(override)]
    subprocess.run(args+['up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','180','app'],check=True)

marker.unlink(missing_ok=True)
try:
    docker('run','-d','--rm','--name',name,'--label','mailweb.test.actor=native-response-loss','--network','mailweb-rebuild_default','-v',f'{project}:{project}','python:3.13-slim-bookworm','python3',str(project/'tests/native-response-loss-proxy.py'),ip('mailweb-rebuild-stalwart-b-1'),str(marker))
    override.write_text(json.dumps({'services':{'app':{'extra_hosts':['stalwart-b:'+ip(name)]}}}))
    app_compose(True);wait()
    # Reuse the private browser acceptance account. Fresh one-command installs
    # create a dedicated ordinary B account through public registration instead.
    fixture=project/'.cache/browser-second-account.json'
    if fixture.exists():
        user=json.loads(fixture.read_text());email=user['email'];c=login(email,user.get('password',D['userPassword']))
    else:
        domains=req('/registration/domains')['items'];domain=next(x['id'] for x in domains if x['domain']=='second.example.com')
        c,email=signup('loss'+str(int(time.time())),domain)
    session=req('/jmap/session',c=c);account=session['platformAccountId']
    boxes=jmap(c,'Mailbox/get')['list'];drafts=next(x['id'] for x in boxes if x.get('role')=='drafts')
    identity=next(x['id'] for x in jmap(c,'Identity/get')['list'] if x['email']==email)
    subject='Accepted response loss '+uuid.uuid4().hex[:10]
    mail=create(c,'Email',{'mailboxIds':{drafts:True},'keywords':{'$draft':True},'from':[{'email':email}],'to':[{'email':'native-loss@recovery.example.net'}],'subject':subject,'textBody':[{'partId':'t','type':'text/plain'}],'bodyValues':{'t':{'value':'Only one message may arrive after the accepted response is lost.'}}})
    request={'using':['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],'methodCalls':[['EmailSubmission/set',{'accountId':account,'create':{'qa_response_loss':{'emailId':mail,'identityId':identity}}},'loss']]}
    key=str(uuid.uuid4())
    lost=req('/jmap',request,'POST',c,502,extra={'Idempotency-Key':key})
    assert marker.exists(),'Response was not lost AFTER actual upstream acceptance'
    assert lost['code']=='submission_check_required',lost
    req('/jmap',request,'POST',c,409,extra={'Idempotency-Key':key})
    req('/jmap',request,'POST',c,409,extra={'Idempotency-Key':str(uuid.uuid4())})
    records=req('/client/submissions',c=c)['items'];record=next(x for x in records if x['id']==key)
    assert record['status']=='unknown',record
    outcome=req('/client/submissions/'+key+'/reconcile',{},'POST',c)
    assert outcome['state']=='accepted' and outcome['retrySafe'] is False,outcome
    for _ in range(100):
        messages=json.load(PUBLIC.open(MAIL+'/api/v1/search?query='+urllib.parse.quote('subject:'+subject)))['messages']
        if messages:break
        time.sleep(.2)
    assert len(messages)==1,messages
    report.write_text(json.dumps({'environment':'local isolated Docker, unmodified official Stalwart B','account':email,'requestId':key,'subject':subject,'upstreamAcceptedBeforeResponseLoss':True,'journalStatus':record['status'],'sameKeyReplayStatus':409,'sameSemanticNewKeyStatus':409,'smtpDeliveredMessages':len(messages),'reconcileOutcome':outcome,'apiReconcileVerified':True},ensure_ascii=False,indent=2)+'\n')
    print('PASS: real official Stalwart accepted; response dropped; unknown journal retained; both replay forms blocked; exactly one SMTP delivery')
finally:
    app_compose(False)
    subprocess.run(['docker','stop',name],check=False,stdout=subprocess.DEVNULL)
    override.unlink(missing_ok=True)
