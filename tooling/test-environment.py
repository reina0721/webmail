"""Idempotent test deployment, exclusively under tests/runtime/rebuild.
Uses the same application initialization API as the UI; never edits its database.
"""
import uuid, urllib.parse, base64, http.cookiejar, json, os, pathlib, secrets, socket, subprocess, sys, time, urllib.request, urllib.error, gzip, re
ROOT=pathlib.Path(sys.argv[2]).resolve()
assert ROOT.parts[-3:]==('tests','runtime','rebuild'), 'Refusing a non-test runtime directory'
SETTINGS=ROOT/'settings.json'
MODE=sys.argv[1]

def request(url,body=None,method=None,headers=None,opener=None):
    data=json.dumps(body).encode() if body is not None else None
    hdr={'Content-Type':'application/json',**(headers or {})}
    if 'Origin' in hdr:hdr['Host']=urllib.parse.urlparse(hdr['Origin']).netloc
    req=urllib.request.Request(url,data=data,method=method,headers=hdr)
    try:
        with (opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))).open(req,timeout=25) as r:
            raw=r.read();raw=gzip.decompress(raw) if raw[:2]==b'\x1f\x8b' else raw
            return r.status,json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{method or "GET"} {req.selector}: HTTP {e.code}: {e.read().decode()[:500]}') from None

def wait(url):
    for _ in range(120):
        try:
            if request(url)[0]==200:return
        except (OSError,RuntimeError):pass
        time.sleep(.5)
    raise RuntimeError('Timed out waiting for '+url)

def compose(*args):
    return subprocess.check_output(['docker','compose','--project-name','mailweb-rebuild','--env-file',str(ROOT/'compose.env'),'-f',str(pathlib.Path(__file__).resolve().parents[1]/'deploy/compose.test.yaml'),*args],text=True).strip()

def save(d):
    SETTINGS.write_text(json.dumps(d,indent=2));SETTINGS.chmod(0o600)

if MODE=='prepare':
    ROOT.mkdir(parents=True,exist_ok=True);os.chmod(ROOT,0o700)
    ports=[]
    for default in [19196,19086,19087,19197]:
        with socket.socket() as s:
            try:s.bind(('127.0.0.1',default))
            except OSError:s.bind(('127.0.0.1',0))
            ports.append(s.getsockname()[1])
    d={'port':ports[0],'upstreamAPort':ports[1],'upstreamBPort':ports[2],'mailpitPort':ports[3],'adminA':secrets.token_hex(24),'adminB':secrets.token_hex(24),'operatorPassword':secrets.token_urlsafe(24),'userPassword':secrets.token_urlsafe(24),'operator':'operator@example.com','user':'sakura@example.com','secondUser':'yuki@second.example.com'}
    d['origin']='http://mailweb.localhost:'+str(d['port'])
    for directory in ['app/secrets','app/config','app/data','app/logs','mailpit','stalwart-a/etc','stalwart-a/data','stalwart-b/etc','stalwart-b/data']:
        p=ROOT/directory;p.mkdir(parents=True,exist_ok=True)
        if directory.startswith('app'):os.chown(p,10001,10001)
        elif directory.startswith('stalwart'):os.chown(p,2000,2000)
    key=ROOT/'app/secrets/session.key';key.write_text(secrets.token_hex(32));key.chmod(0o600);os.chown(key,10001,10001)
    entries={'MAIL_WEB_TEST_ROOT':str(ROOT),'MAIL_WEB_TEST_PORT':d['port'],'MAIL_WEB_TEST_STALWART_A_PORT':d['upstreamAPort'],'MAIL_WEB_TEST_STALWART_B_PORT':d['upstreamBPort'],'MAIL_WEB_TEST_MAILPIT_PORT':d['mailpitPort'],'MAIL_WEB_TEST_ADMIN_A':d['adminA'],'MAIL_WEB_TEST_ADMIN_B':d['adminB']}
    env=ROOT/'compose.env';env.write_text('\n'.join(f'{k}={v}' for k,v in entries.items())+'\n');env.chmod(0o600);save(d);sys.exit()
d=json.loads(SETTINGS.read_text());BASE='http://127.0.0.1:'+str(d['port']);ORIGIN=d['origin']

def admin_rpc(which,method,args):
    port=d['upstream'+which+'Port'];auth='Basic '+base64.b64encode(('bootstrap:'+d['admin'+which]).encode()).decode()
    _,response=request(f'http://127.0.0.1:{port}/jmap/',{'using':['urn:ietf:params:jmap:core','urn:stalwart:jmap'],'methodCalls':[[method,args,'r']]},headers={'Authorization':auth})
    result=response['methodResponses'][0]
    if result[0]!=method or any(result[1].get(k) for k in ['notCreated','notUpdated','notDestroyed']):raise RuntimeError(method+': '+json.dumps(result[1]))
    return result[1]

def capability():return (ROOT/'app/secrets/setup.key').read_text().strip()
OPENER=None
JAR=None
def app(path,body=None,method=None,opener=None):
    global OPENER,JAR
    hdr={'Origin':ORIGIN,'Authorization':'Bearer '+capability()}
    if path.startswith('/admin/'):
        if OPENER is None:
            JAR=http.cookiejar.CookieJar();OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(JAR))
            request(BASE+'/api/v1/auth/login',{'email':d['operator'],'password':d['operatorPassword']},'POST',{'Origin':ORIGIN},OPENER)
        opener=OPENER;hdr.pop('Authorization');hdr['X-CSRF-Token']=next(c.value for c in JAR if c.name=='mail_csrf')
    return request(BASE+'/api/v1'+path,body,method,hdr,opener)[1]

def restart():
    compose('restart','app');wait(BASE+'/api/v1/health/ready')

def initialize(which,service=''):
    suffix='?serviceId='+service if service else ''
    prefix='/installation/initialize/'
    auth=app(prefix+'authorize'+suffix,{'base':'http://stalwart-'+which.lower()+':8080','username':'bootstrap','password':d['admin'+which],'operatorPassword':d['operatorPassword']},'POST')
    spec={'brand':'Mail Web','domain':'example.com' if which=='A' else 'second.example.com','publicOrigin':ORIGIN,'createDomain':False,'directoryQueries':True,'operatorMode':'new','operatorEmail':d['operator'],'recoveryEmail':'operator@recovery.example.net','cloudflareAccount':''}
    body={'ticket':auth['ticket'],'spec':spec,'operatorPassword':d['operatorPassword']}
    app(prefix+'preflight'+suffix,body,'POST');app(prefix+'job'+suffix,body,'POST')
    for _ in range(160):
        try:
            job=app(prefix+'job'+suffix)['job']
            if job['status']=='failed':raise RuntimeError('Initialization failed: '+job['error'])
            if job['status']=='completed':return
        except (OSError,RuntimeError) as e:
            if 'Initialization failed' in str(e):raise
        time.sleep(.5)
    raise RuntimeError('Initialization did not finish')

def mail_code(to,after=0):
    for _ in range(100):
        result=request(f'http://127.0.0.1:{d["mailpitPort"]}/api/v1/search?query=to:'+urllib.parse.quote(to))[1]
        for m in result.get('messages',[]):
            message=request(f'http://127.0.0.1:{d["mailpitPort"]}/api/v1/message/'+m['ID'])[1]
            match=re.search(r'验证码(?:为|是)?[：:\s]*(\d{6})',message.get('Text',''))
            if match:return match[1]
        time.sleep(.3)
    raise RuntimeError('Verification email did not reach the SMTP receiver')

if MODE=='network':
    import ipaddress
    try:answers=[ipaddress.ip_address(v[4][0]) for v in socket.getaddrinfo('calendar.google.com',443,socket.AF_INET)]
    except OSError:answers=[]
    fake=any(v in ipaddress.ip_network('198.18.0.0/15') for v in answers)
    env=ROOT/'compose.env';lines=[line for line in env.read_text().splitlines() if not line.startswith('MAIL_WEB_TEST_CALENDAR_DOH=')]
    lines.append('MAIL_WEB_TEST_CALENDAR_DOH='+('https://1.1.1.1/dns-query' if fake else ''))
    env.write_text('\n'.join(lines)+'\n');env.chmod(0o600)
    print('Calendar DNS: '+('trusted public DoH for detected proxy fake-IP DNS; private addresses stay blocked' if fake else 'validated system DNS'))
    sys.exit()
if MODE=='status':
    print('Webmail: '+ORIGIN+'/');print('SMTP test inbox: http://127.0.0.1:'+str(d['mailpitPort']));print('Test credentials (private): '+str(SETTINGS));sys.exit()
if MODE!='bootstrap':raise RuntimeError('Unknown mode')
wait(BASE+'/api/v1/health/ready')
for which in ['A','B']:
    url=f'http://127.0.0.1:{d["upstream"+which+"Port"]}';wait(url+'/healthz/live')
    if not d.get('bootstrapped'+which):
        domain='example.com' if which=='A' else 'second.example.com'
        admin_rpc(which,'x:Bootstrap/set',{'update':{'singleton':{'defaultHostname':'mx.'+domain,'defaultDomain':domain,'requestTlsCertificate':False,'generateDkimKeys':False,'tracer':{'@type':'Stdout','ansi':False}}}})
        compose('restart','stalwart-'+which.lower());wait(url+'/healthz/live');d['bootstrapped'+which]=True;save(d)
    if not d.get('relay'+which):
        routes=admin_rpc(which,'x:MtaRoute/get',{})['list']
        route=next((r for r in routes if r['name']=='test-sink'),None)
        if not route:admin_rpc(which,'x:MtaRoute/set',{'create':{'sink':{'@type':'Relay','name':'test-sink','description':'Isolated SMTP test receiver','host':'mailpit','port':1025,'protocol':'smtp','implicitTls':False,'allowInvalidCerts':False}}})
        admin_rpc(which,'x:MtaOutboundStrategy/set',{'update':{'singleton':{'route':{'match':{'0':{'if':'is_local_domain(rcpt_domain)','then':"'local'"}},'else':"'test-sink'"}}}})
        admin_rpc(which,'x:Action/set',{'create':{'reload':{'@type':'ReloadSettings'}}});d['relay'+which]=True;save(d)
if not app('/installation')['configured']:initialize('A')
for _ in range(30):
    if not app('/installation')['needsOperator']:break
    time.sleep(.5)
if not d.get('turnstileConfigured'):
    config=app('/installation/config')['settings'];config.update(turnstileSiteKey='1x00000000000000000000AA',turnstileSecret='1x0000000000000000000000000000000AA');app('/installation/config',config,'PUT');time.sleep(2);wait(BASE+'/api/v1/health/ready');d['turnstileConfigured']=True;save(d)
connections=app('/installation/connections')
second=next((s for s in connections['services'] if s['origin']=='http://stalwart-b:8080'),None)
if not second:
    second=app('/installation/connections/prepare',{'id':str(uuid.uuid4()),'name':'第二邮件服务','origin':'http://stalwart-b:8080'},'POST')
    second_id=second.get('id',second.get('serviceId'))
else:second_id=second['id']
if second_id and not any(x['serviceId']==second_id for x in app('/installation/connections')['domains']):initialize('B',second_id)
# Extend the completed initialization through the application's own authorized API.
# No direct DB or service credential edits are used for a permission upgrade.
for which,service in [('A',''),('B',second_id)]:
    if not d.get('directoryReady'+which) or d.get('automaticGatewayVersion'+which,0)<2:
        initialize(which,service)
        assert admin_rpc(which,'x:Sharing/get',{'ids':['singleton']})['list'][0]['allowDirectoryQueries'] is True
        d['directoryReady'+which]=True
        d['automaticGatewayReady'+which]=True
        d['automaticGatewayVersion'+which]=2
        if which=='A':d['verified']=False
        save(d)
if not d.get('verified'):
    report=app('/installation/readiness',{},'POST')
    if any(i['status']!='passed' for i in report['items']):raise RuntimeError('Readiness failures: '+json.dumps([i for i in report['items'] if i['status']!='passed']))
    link=app('/installation/readiness/link',{},'POST')['url'];ticket=urllib.parse.parse_qs(urllib.parse.urlparse(link).fragment)['check'][0]
    app('/readiness/send',{'ticket':ticket,'email':'readiness@recovery.example.net','turnstile_token':'XXXX.DUMMY.TOKEN.XXXX'},'POST')
    app('/readiness/verify',{'ticket':ticket,'code':mail_code('readiness@recovery.example.net')},'POST')
    app('/admin/registration',{'enabled':True,'maximumAccounts':100,'quotaBytes':1073741824,'attachmentBytes':20971520,'hourlyRecipients':100,'dailyRecipients':500},'PATCH')
    d['verified']=True;save(d)
if not d.get('registered'):
    claim=d.get('challenge') or app('/registration/challenges',{'email':'sakura@recovery.example.net','purpose':'registration','domainId':'default','turnstile_token':'XXXX.DUMMY.TOKEN.XXXX'},'POST')
    d['challenge']=claim;save(d)
    code=mail_code('sakura@recovery.example.net');verification=app('/registration/verify',{'challenge_id':claim['challengeId'],'code':code},'POST')
    app('/auth/register',{'challenge_id':claim['challengeId'],'verification_token':verification['verificationToken'],'name':'sakura','password':d['userPassword']},'POST')
    d['registered']=True;save(d)
print('Automatic setup and real SMTP registration completed.')
