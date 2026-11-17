"""Real Docker/Stalwart integration and optional 30-minute signup soak.
No direct application DB edits. Official Turnstile test keys and SMTP delivery.
"""
import os, base64, datetime, hashlib, http.cookiejar, io, json, pathlib, re, secrets, subprocess, sys, time, urllib.request, urllib.error, urllib.parse, uuid
ROOT=pathlib.Path(sys.argv[1]).resolve();assert ROOT.parts[-3:]==('tests','runtime','rebuild')
D=json.loads((ROOT/'settings.json').read_text());BASE=os.environ.get('MAIL_WEB_TEST_BASE','http://127.0.0.1:'+str(D['port']));ORIGIN=D['origin'];MAIL=os.environ.get('MAIL_WEB_TEST_MAILPIT','http://127.0.0.1:'+str(D['mailpitPort']));EVIDENCE=[]

def client():return urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
PUBLIC=client()
def req(path,body=None,method=None,c=None,expected=200,raw=None,kind='application/json',extra=None):
 c=c or PUBLIC;headers={'Origin':ORIGIN,'Host':urllib.parse.urlparse(ORIGIN).netloc,'Content-Type':kind}
 for handler in c.handlers:
  if isinstance(handler,urllib.request.HTTPCookieProcessor):
   for cookie in handler.cookiejar:
    if cookie.name=='mail_csrf':headers['X-CSRF-Token']=cookie.value
 if extra:headers.update(extra)
 selector=headers.get('X-Mail-Account')
 if selector:
  for handler in c.handlers:
   if isinstance(handler,urllib.request.HTTPCookieProcessor):
    for cookie in handler.cookiejar:
     if cookie.name=='mail_csrf_'+selector.encode().hex():headers['X-CSRF-Token']=cookie.value
 data=raw if raw is not None else json.dumps(body).encode() if body is not None else None
 try:
  with c.open(urllib.request.Request(BASE+'/api/v1'+path,data=data,method=method,headers=headers),timeout=25) as r:
   status=r.status;payload=r.read();value=json.loads(payload) if payload and ('json' in r.headers.get('Content-Type','')) else payload
 except urllib.error.HTTPError as e:
  status=e.code;payload=e.read()
  try:value=json.loads(payload)
  except json.JSONDecodeError:value=payload.decode(errors="replace")[:1000]
 assert status==expected,(method,path,status,value)
 return value

def passed(message):
 print('PASS:',message,flush=True);EVIDENCE.append({'check':message,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()})

def login(email,password):
 # Repeated actors must not spend the fixed fixture's production login bucket
 # just to obtain another identical session. New signup/fault-test users still
 # perform fresh password logins; invalid passwords never consult this cache.
 fixture=(email==D.get('operator') and password==D.get('operatorPassword')) or (email==D.get('user') and password==D.get('userPassword'))
 if not fixture:
  c=client();req('/auth/login',{'email':email,'password':password},'POST',c,204);return c
 directory=ROOT/'actor-sessions';directory.mkdir(mode=0o700,exist_ok=True)
 saved=directory/(hashlib.sha256((email+'\0'+password).encode()).hexdigest()+'.cookies')
 jar=http.cookiejar.LWPCookieJar(str(saved));c=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(jar))
 if saved.exists():
  try:
   jar.load(ignore_discard=True,ignore_expires=True)
   if req('/auth/session',c=c)['email']==email:return c
  except (OSError,AssertionError):jar.clear()
 cooldown_end=time.monotonic()+660;announced=False
 while True:
  try:
   req('/auth/login',{'email':email,'password':password},'POST',c,204);break
  except AssertionError as error:
   detail=error.args[0] if error.args else None
   if not isinstance(detail,tuple) or len(detail)<3 or detail[2]!=429 or time.monotonic()>=cooldown_end:raise
   if not announced:
    print('Waiting for the fixed fixture login cooldown; production limits unchanged.',flush=True);announced=True
   time.sleep(60)
 jar.save(ignore_discard=True,ignore_expires=True);saved.chmod(0o600)
 return c

def mail_code(to):
 url=MAIL+'/api/v1/search?query='+urllib.parse.quote('to:'+to)
 for _ in range(100):
  data=json.load(PUBLIC.open(url,timeout=10))
  for m in data.get('messages',[]):
   value=json.load(PUBLIC.open(MAIL+'/api/v1/message/'+m['ID'],timeout=10));match=re.search(r'验证码(?:为|是)?[：:\s]*(\d{6})',value.get('Text',''))
   if match:return match[1]
  time.sleep(.3)
 raise AssertionError('SMTP verification email missing for '+to)

def signup(name,domain='default'):
 recovery=name+'@recovery.example.net'
 challenge=req('/registration/challenges',{'email':recovery,'purpose':'registration','domainId':domain,'turnstile_token':'XXXX.DUMMY.TOKEN.XXXX'},'POST')
 token=req('/registration/verify',{'challenge_id':challenge['challengeId'],'code':mail_code(recovery)},'POST')['verificationToken']
 req('/auth/register',{'challenge_id':challenge['challengeId'],'verification_token':token,'name':name,'password':D['userPassword']},'POST',expected=204)
 domains=req('/registration/domains');domain_name=next(x['domain'] for x in domains['items'] if x['id']==domain)
 return login(name+'@'+domain_name,D['userPassword']),name+'@'+domain_name

def jmap(c,method,args=None,expected=200):
 session=req('/jmap/session',c=c);kind=method.split('/')[0];cap='submission' if kind in ['Identity','EmailSubmission'] else 'calendars' if kind.startswith('Calendar') else 'contacts' if kind in ['AddressBook','ContactCard'] else 'filenode' if kind=='FileNode' else 'principals' if kind=='Principal' else 'mail'
 result=req('/jmap',{'using':['urn:ietf:params:jmap:core','urn:ietf:params:jmap:'+cap],'methodCalls':[[method,{'accountId':session['platformAccountId'],**(args or {})},'t']]},'POST',c,expected)
 if expected!=200:return result
 response=result['methodResponses'][0];assert response[0]==method,response
 for k in ['notCreated','notUpdated','notDestroyed']:assert not response[1].get(k),response[1]
 return response[1]

def create(c,kind,value):return jmap(c,kind+'/set',{'create':{'new':value}})['created']['new']['id']

def upload(c,name,data,kind='text/plain'):
 boundary='mailweb'+uuid.uuid4().hex
 body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {kind}\r\n\r\n').encode()+data+f'\r\n--{boundary}--\r\n'.encode()
 return req('/attachments',method='POST',c=c,raw=body,kind='multipart/form-data; boundary='+boundary)

def compose(*args):
 return subprocess.check_output(['docker','compose','--project-name','mailweb-rebuild','--env-file',str(ROOT/'compose.env'),'-f',str(pathlib.Path(__file__).resolve().parents[1]/'deploy/compose.test.yaml'),*args],text=True).strip()

def wait():
 for _ in range(120):
  try:req('/health/ready');return
  except (OSError,AssertionError):time.sleep(.5)
 raise AssertionError('App did not recover')

def enable_domain(domain,operator):
 setup=(ROOT/'app/secrets/setup.key').read_text().strip()
 def cap(path,body=None):
  headers={'Authorization':'Bearer '+setup,'Origin':ORIGIN,'Host':urllib.parse.urlparse(ORIGIN).netloc,'Content-Type':'application/json'}
  with PUBLIC.open(urllib.request.Request(BASE+'/api/v1'+path,data=json.dumps(body or {}).encode(),headers=headers),timeout=25) as r:return json.load(r)
 report=cap('/installation/readiness?domainId='+domain);assert all(i['status']=='passed' for i in report['items']),report
 link=cap('/installation/readiness/link?domainId='+domain)['url'];ticket=urllib.parse.parse_qs(urllib.parse.urlparse(link).fragment)['check'][0];receiver='ready-'+uuid.uuid4().hex[:6]+'@recovery.example.net'
 req('/readiness/send',{'ticket':ticket,'email':receiver,'turnstile_token':'XXXX.DUMMY.TOKEN.XXXX'},'POST');req('/readiness/verify',{'ticket':ticket,'code':mail_code(receiver)},'POST')
 req('/admin/registration?domainId='+domain,{'enabled':True,'maximumAccounts':100,'quotaBytes':1073741824,'attachmentBytes':20971520,'hourlyRecipients':100,'dailyRecipients':500},'PATCH',operator,204)
