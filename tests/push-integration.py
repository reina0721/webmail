"""Real-service background notification adapters, including colliding account IDs."""
from environment_client import *
import hashlib
operator=login(D['operator'],D['operatorPassword']);alice=login(D['user'],D['userPassword']);stamp=uuid.uuid4().hex[:8]
def background(path,c,body=None,expected=200,site='same-origin',origin=ORIGIN):
 headers={'Origin':origin,'Sec-Fetch-Site':site,'Host':urllib.parse.urlparse(ORIGIN).netloc,'Content-Type':'application/json'}
 request=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 try:
  with c.open(request,timeout=25) as response:status=response.status;value=json.load(response);assert response.headers.get('Cache-Control')=='no-store'
 except urllib.error.HTTPError as error:status=error.code;value=json.load(error)
 assert status==expected,(path,status,value)
 return value
def fingerprint(email):return hashlib.sha256((ORIGIN+'/api/v1/native\n'+email.lower()).encode()).hexdigest()[:32]
req('/auth/login',{'email':D['user'],'password':D['userPassword']},'POST',operator,204,extra={'X-Mail-Link':'1'})
account=req('/jmap/session',c=alice)['platformAccountId'];subject='Background notification '+stamp
draft={'to':[D['user']],'cc':[],'bcc':[],'subject':subject,'text':'Notification preview and action verification','html':'<p>Notification preview and action verification</p>','attachments':[]}
req('/submissions',{'idempotency_key':str(uuid.uuid4()),'draft':draft},'POST',operator)
for _ in range(80):
 messages=req('/messages?search='+urllib.parse.quote(subject),c=alice)['items']
 if messages:break
 time.sleep(.25)
else:raise AssertionError('Notification test mail did not arrive')
message=messages[0];email_id=message['id'];query=urllib.parse.urlencode({'accountId':account,'emailId':email_id,'login':D['user']})
preview=background('/api/push/preview?'+query,operator)
assert preview['email']['subject']==subject and preview['login']==fingerprint(D['user'])
assert preview['nativeAccountId']==D['user']+'@'+urllib.parse.urlparse(ORIGIN).hostname
assert not any(key in json.dumps(preview).lower() for key in ['upstream_key','authorization','provisioning_key','cookie-session'])
passed('A service-worker preview reads the named linked mailbox while another account is primary, returns the correct native deep-link owner and exposes no upstream credential')
action={'action':'mark-read','accountId':account,'emailId':email_id,'login':preview['login']}
background('/api/push/action',operator,action)
assert jmap(alice,'Email/get',{'ids':[email_id],'properties':['id','keywords']})['list'][0]['keywords']['$seen'] is True
background('/api/push/action',operator,{**action,'action':'archive','archiveMode':'month','timeZone':'America/New_York'})
changed=jmap(alice,'Email/get',{'ids':[email_id],'properties':['id','mailboxIds']})['list'][0]
folder_id=next(iter(changed['mailboxIds']));folders=jmap(alice,'Mailbox/get')['list'];folder=next(f for f in folders if f['id']==folder_id);year=next(f for f in folders if f['id']==folder['parentId']);archive=next(f for f in folders if f['id']==year['parentId'])
assert archive['role']=='archive' and len(year['name'])==4 and len(folder['name'])==2
jmap(alice,'Email/set',{'update':{email_id:{'mailboxIds':message['mailboxIds'],'keywords':message['keywords']}}})
passed('Closed-page notification actions mark the correct mailbox message read and archive it into native year/month folders, then restore the original message state')
background('/api/push/preview?'+query,operator,expected=403,site='cross-site')
background('/api/push/action',operator,action,expected=403,origin='https://foreign.invalid')
background('/api/push/action',operator,{**action,'login':'0'*32},expected=401)
background('/api/push/action',operator,{**action,'emailId':'../foreign'},expected=400)
background('/api/push/preview?'+query,client(),expected=401)
passed('Cross-origin wakeups/actions, missing sessions, invalid IDs and stale login fingerprints are rejected')
def admin(which):
 auth='Basic '+base64.b64encode(('bootstrap:'+D['admin'+which]).encode()).decode()
 body={'using':['urn:ietf:params:jmap:core','urn:stalwart:jmap'],'methodCalls':[['x:Account/get',{'properties':['id','name','emailAddress']},'p']]}
 request=urllib.request.Request('http://stalwart-'+which.lower()+':8080/jmap/',data=json.dumps(body).encode(),headers={'Authorization':auth,'Content-Type':'application/json'})
 return json.load(PUBLIC.open(request,timeout=25))['methodResponses'][0][1]['list']
def test_users(rows):return {r['id']:r['emailAddress'] for r in rows if re.match(r'^(?:haru|yuki|soak|gw)[a-z0-9]+$',r.get('name','')) and r.get('emailAddress')}
a,b=test_users(admin('A')),test_users(admin('B'));common=set(a)&set(b)
assert common,'No colliding ordinary-account test fixture; seed through signup first'
same=next(iter(common));first=login(a[same],D['userPassword'])
req('/auth/login',{'email':b[same],'password':D['userPassword']},'POST',first,204,extra={'X-Mail-Link':'1'})
background('/api/push/preview?'+urllib.parse.urlencode({'accountId':same}),first,expected=409)
selected=background('/api/push/preview?'+urllib.parse.urlencode({'accountId':same,'login':b[same]}),first)
assert selected['login']==fingerprint(b[same]) and selected['nativeAccountId'].startswith(b[same]+'@')
passed('A real repeated JMAP account ID on two official Stalwarts is ambiguous without its verified login label; the label resolves the correct server and mailbox')
(ROOT/'push-report.json').write_text(json.dumps(EVIDENCE,indent=2))
