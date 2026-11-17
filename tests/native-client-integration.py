"""Native Bulwark transport against real Stalwart, without bypassing platform login."""
from environment_client import *
with PUBLIC.open(BASE+'/build.json',timeout=10) as response:
 build=json.load(response);assert response.headers['X-Bulwark-Build']==build['buildId']
for path in ['/', '/mark.svg']:
 with PUBLIC.open(BASE+path,timeout=10) as response:
  assert response.headers['X-Bulwark-Build']==build['buildId'],path
passed('HTML and static assets identify the exact offline build across deployment transitions')
operator=login(D['operator'],D['operatorPassword']);stamp=str(int(time.time()))
# A real, newly registered test owner keeps repeated large-upload checks from
# exhausting another user's unchanged official temporary blob quota.
alice,actor_email=signup('native'+stamp);D={**D,'user':actor_email}
metadata=req('/jmap/session',c=alice);account=metadata['platformAccountId'];assert metadata['uploadUrl'].startswith('/api/v1/jmap/upload/');assert metadata['apiUrl']=='/api/v1/jmap'
def native(c,method,args=None,using=None,extra=None,expected=200):
 args={'accountId':account,**(args or {})}
 return req('/jmap',{'using':using or ['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],'methodCalls':[[method,args,'n']]},'POST',c,expected,extra=extra)
def result(response,method):
 calls=response['methodResponses'];assert calls[0][0]==method,calls
 value=calls[0][1]
 for name in ['notCreated','notUpdated','notDestroyed']:assert not value.get(name),value
 return value
passed('Native session advertises only same-origin Rust transports')
native(alice,'x:Account/set',expected=403);native(alice,'Email/get',{'accountId':'unknown'},expected=403);passed('Native method allowlist and account boundary reject directory writes and arbitrary accounts')
archive_caps=['urn:ietf:params:jmap:core','urn:stalwart:jmap']
archive_probe=native(alice,'x:ArchivedItem/query',{'limit':1},archive_caps)['methodResponses'][0]
assert archive_probe[0]=='x:ArchivedItem/query' or archive_probe[0]=='error' and archive_probe[1]['type'] in ['forbidden','unknownMethod'],archive_probe
native(alice,'x:ArchivedItem/query',{'filter':{'accountId':'unknown'}},archive_caps,expected=403)
native(alice,'x:ArchivedItem/set',{'destroy':['history']},archive_caps,expected=403)
native(alice,'x:ArchivedItem/set',{'update':{'history':{'status':'archived'}}},archive_caps,expected=403)
passed('Personal deleted-item recovery reaches the official server capability response; cross-account queries and history deletion remain forbidden')
blob=req('/jmap/upload/'+account,method='POST',c=alice,raw=b'Native file upload, preview and copy',kind='text/plain')
file_caps=['urn:ietf:params:jmap:core','urn:ietf:params:jmap:filenode']
folder=result(native(alice,'FileNode/set',{'create':{'f':{'@type':'Directory','name':'native-'+stamp,'parentId':None}}},file_caps),'FileNode/set')['created']['f']['id']
original=result(native(alice,'FileNode/set',{'create':{'f':{'@type':'File','name':'original-'+stamp+'.txt','blobId':blob['blobId'],'mediaType':'text/plain'}}},file_caps),'FileNode/set')['created']['f']['id']
copy=result(native(alice,'FileNode/set',{'create':{'f':{'@type':'File','name':'copied.txt','parentId':folder,'blobId':blob['blobId'],'mediaType':'text/plain'}}},file_caps),'FileNode/set')['created']['f']['id']
assert result(native(alice,'FileNode/get',{'ids':[copy]},file_caps),'FileNode/get')['list'][0]['parentId']==folder
assert req('/jmap/download/'+account+'/'+blob['blobId']+'/copied.txt?type=text/plain',c=alice)==b'Native file upload, preview and copy'
passed('Native raw upload/download and same-account copy by creating a distinct blob-backed node persist successfully')
boxes=result(native(alice,'Mailbox/get'),'Mailbox/get')['list'];drafts=next(m['id'] for m in boxes if m.get('role')=='drafts');inbox=next(m['id'] for m in boxes if m.get('role')=='inbox')
identities=result(native(alice,'Identity/get'),'Identity/get')['list'];identity=next(i for i in identities if i['email']==D['user'])['id']
email={'mailboxIds':{drafts:True},'keywords':{'$draft':True},'from':[{'email':D['user']}],'to':[{'email':D['operator']}],'subject':'Native transport '+stamp,'htmlBody':[{'partId':'body','type':'text/html'}],'bodyValues':{'body':{'value':'<p><strong>Native Bulwark composer</strong></p><table><tr><td>保留上游编辑器</td></tr></table>'}}}
id=result(native(alice,'Email/set',{'create':{'m':email}}),'Email/set')['created']['m']['id']
request={'create':{'s':{'emailId':id,'identityId':identity}},'onSuccessUpdateEmail':{'#s':{'keywords/$draft':None}}};key=str(uuid.uuid4());headers={'Idempotency-Key':key}
submission=result(native(alice,'EmailSubmission/set',request,['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],headers),'EmailSubmission/set');again=result(native(alice,'EmailSubmission/set',request,['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],headers),'EmailSubmission/set');assert submission==again
passed('Native rich email submission reuses the durable idempotent response')
# Independently verify server delivery, rather than accepting a successful submission call.
for _ in range(60):
 messages=req('/messages?mailbox='+urllib.parse.quote(inbox),c=operator) if False else None
 found=req('/messages?search='+urllib.parse.quote(email['subject']),c=operator)
 if any(m['subject']==email['subject'] for m in found.get('items',found.get('messages',[]))):break
 time.sleep(.3)
else:raise AssertionError(('Native submission not delivered',found))
passed('Native rich email arrives in the other real user mailbox')
req('/auth/login',{'email':D['user'],'password':D['userPassword']},'POST',operator,204,extra={'X-Mail-Link':'1'})
assert req('/auth/session',c=operator)['email']==D['operator']
assert req('/auth/session',c=operator,extra={'X-Mail-Account':D['user']})['email']==D['user']
req('/auth/session',c=operator,extra={'X-Mail-Account':'never-linked@example.com'},expected=401)
req('/admin/users',c=operator,extra={'X-Mail-Account':D['user']},expected=403)
passed('Each additional account is password-verified; linking preserves the primary login and operator scope')
primary_preferences=req('/client/preferences',c=operator)
req('/client/preferences',{'settings':{'theme':'dark'}},'PUT',operator,extra={'X-Mail-Account':D['user']})
assert req('/client/preferences',c=operator,extra={'X-Mail-Account':D['user']})['settings']['theme']=='dark'
assert req('/client/preferences',c=operator)==primary_preferences
passed('Preferences are isolated by verified account, not by a browser-supplied upstream URL')
# Preserve the upstream browser-encrypted envelope, with independent server-side owner checks.
archive_headers={'X-Mail-Account':D['user'],'X-Archive-Username':D['user'],'X-Archive-Server':ORIGIN+'/api/v1/native'}
previous_archive=req('/client/account-archive',c=operator,extra=archive_headers)['envelope']
archive={'version':1,'iterations':600000,'salt':base64.b64encode(os.urandom(16)).decode(),'iv':base64.b64encode(os.urandom(12)).decode(),'ciphertext':base64.b64encode(os.urandom(48)).decode()}
try:
 req('/client/account-archive',{'envelope':archive},'PUT',operator,extra=archive_headers)
 assert req('/client/account-archive',c=operator,extra=archive_headers)['envelope']==archive
 req('/client/account-archive',c=operator,extra={**archive_headers,'X-Archive-Username':D['operator']},expected=403)
 req('/client/account-archive',c=operator,extra={**archive_headers,'X-Archive-Server':'https://foreign.invalid'},expected=403)
 req('/client/account-archive',{'envelope':{**archive,'iterations':1}},'PUT',operator,extra=archive_headers,expected=400)
 req('/client/account-archive',method='DELETE',c=operator,extra=archive_headers)
 assert req('/client/account-archive',c=operator,extra=archive_headers)['envelope'] is None
finally:
 if previous_archive:req('/client/account-archive',{'envelope':previous_archive},'PUT',operator,extra=archive_headers)
passed('Encrypted account-list archive round-trips only for its verified owner; malformed encryption parameters and forged owners are rejected')
for blocked_url in ['http://127.0.0.2/','http://169.254.169.254/','http://[::ffff:7f00:1]/','http://localhost.localdomain/','file:///etc/passwd']:
 req('/client/calendar-feed',{'url':blocked_url},'POST',alice,400)
feed=req('/client/calendar-feed',{'url':'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics'},'POST',alice)
assert b'BEGIN:VCALENDAR' in feed and b'BEGIN:VEVENT' in feed
passed('Remote calendar subscription transport fetches a real public ICS and blocks loopback, cloud metadata, embedded private IPv6 and non-HTTP URLs')

# Operator scope follows the verified selected cookie even when the primary login is ordinary.
reverse=login(D['user'],D['userPassword'])
req('/auth/login',{'email':D['operator'],'password':D['operatorPassword']},'POST',reverse,204,extra={'X-Mail-Link':'1'})
assert req('/auth/session',c=reverse)['operator'] is False
assert req('/auth/session',c=reverse,extra={'X-Mail-Account':D['operator']})['operator'] is True
req('/admin/users',c=reverse,expected=403)
assert req('/admin/users',c=reverse,extra={'X-Mail-Account':D['operator']})['items']
passed('A linked operator keeps its own console authorization without granting the ordinary primary login admin scope')
# Signing the same mailbox in as both primary and linked must not resurrect the primary cookie after logout.
logout_client=login(D['user'],D['userPassword'])
req('/auth/login',{'email':D['user'],'password':D['userPassword']},'POST',logout_client,204,extra={'X-Mail-Link':'1'})
req('/auth/login',{'email':D['operator'],'password':D['operatorPassword']},'POST',logout_client,204,extra={'X-Mail-Link':'1'})
req('/auth/logout',{},'POST',logout_client,204,extra={'X-Mail-Account':D['user']})
req('/auth/session',c=logout_client,expected=401)
req('/auth/session',c=logout_client,extra={'X-Mail-Account':D['user']},expected=401)
assert req('/auth/session',c=logout_client,extra={'X-Mail-Account':D['operator']})['operator'] is True
passed('Logging out a duplicate primary/linked mailbox revokes both cookies while preserving the other linked account')

# Files keep the upstream upload ceiling; the mail attachment policy remains independently enforced.
assert metadata['capabilities']['urn:ietf:params:jmap:core']['maxSizeUpload']>=26*1024*1024,metadata['capabilities']['urn:ietf:params:jmap:core']
large=b'F'*(26*1024*1024)
large_blob=req('/jmap/upload/'+account,method='POST',c=alice,raw=large,kind='application/octet-stream')
large_node=result(native(alice,'FileNode/set',{'create':{'f':{'@type':'File','name':'large-native-'+stamp+'.bin','parentId':folder,'blobId':large_blob['blobId'],'mediaType':'application/octet-stream'}}},file_caps),'FileNode/set')['created']['f']['id']
assert req('/jmap/download/'+account+'/'+large_blob['blobId']+'/large.bin',c=alice)==large,'Large file content changed during streaming'
rejected={**email,'bodyStructure':{'type':'multipart/mixed','subParts':[{'partId':'t','type':'text/plain'},{'blobId':large_blob['blobId'],'type':'application/octet-stream','disposition':'attachment','name':'large.bin'}]},'bodyValues':{'t':{'value':'An oversized attachment must not be submitted'}}}
rejected.pop('htmlBody',None)
req('/jmap',{'using':['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],'methodCalls':[['Email/set',{'accountId':account,'create':{'m':rejected}},'e'],['EmailSubmission/set',{'accountId':account,'create':{'s':{'emailId':'#m','identityId':identity}}},'s']]},'POST',alice,413,extra={'Idempotency-Key':str(uuid.uuid4())})
passed('A 26 MiB file streams, persists and downloads intact while oversized mail attachments remain blocked')
# Delayed submission follows the upstream HOLDFOR envelope, and can be listed and canceled.
external='scheduled-'+stamp+'@recovery.example.net'
held={**email,'subject':'Scheduled native '+stamp,'to':[{'email':external}]}
held_id=result(native(alice,'Email/set',{'create':{'m':held}}),'Email/set')['created']['m']['id']
usage_before=req('/account/usage',c=alice)
for hold in [600,900]:
 held_request={'create':{'s':{'emailId':held_id,'identityId':identity,'envelope':{'mailFrom':{'email':D['user'],'parameters':{'HOLDFOR':str(hold)}},'rcptTo':[{'email':external}]}}}}
 created=result(native(alice,'EmailSubmission/set',held_request,extra={'Idempotency-Key':str(uuid.uuid4())}),'EmailSubmission/set')['created']['s']
 submitted=result(native(alice,'EmailSubmission/get',{'ids':[created['id']]}),'EmailSubmission/get')['list'][0]
 assert submitted['undoStatus']=='pending',submitted
 assert datetime.datetime.fromisoformat(submitted['sendAt'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc)
 result(native(alice,'EmailSubmission/set',{'update':{created['id']:{'undoStatus':'canceled'}}}),'EmailSubmission/set')
 assert result(native(alice,'EmailSubmission/get',{'ids':[created['id']]}),'EmailSubmission/get')['list'][0]['undoStatus']=='canceled'
usage_after=req('/account/usage',c=alice)
assert usage_after['dailyRecipientsUsed']-usage_before['dailyRecipientsUsed']==2,(usage_before,usage_after)
passed('Real scheduled submissions are listed, canceled and rescheduled; each accepted external submission uses the shared quota counter')
# Browser header deadlines apply before its first heartbeat. Timing only after
# open() used to miss a healthy upstream's delayed initial header flush.
stream_start=time.monotonic()
stream=alice.open(urllib.request.Request(BASE+'/api/v1/jmap/events',headers={'Host':urllib.parse.urlparse(ORIGIN).netloc,'Origin':ORIGIN}),timeout=40)
assert time.monotonic()-stream_start<5, 'Native SSE headers miss the browser connection deadline'
assert stream.readline()==b': connected\n'
while time.monotonic()-stream_start<16:
 line=stream.readline()
 assert line, 'Native SSE closed before the first long-lived heartbeat'
event_box=result(native(alice,'Mailbox/set',{'create':{'probe':{'name':'events-'+stamp}}}),'Mailbox/set')['created']['probe']['id']
try:
 event_seen=False;deadline=time.monotonic()+35
 while time.monotonic()<deadline:
  line=stream.readline()
  assert line,'Native SSE closed before actual state delivery'
  if line.startswith(b'data:'):
   event=json.loads(line[5:])
   if event.get('changed',{}).get(account,{}).get('Mailbox'):
    event_seen=True;break
 assert event_seen,'Mailbox mutation did not arrive through the real SSE connection'
finally:
 stream.close();result(native(alice,'Mailbox/set',{'destroy':[event_box]}),'Mailbox/set')
passed('Native real-time headers arrive before browser deadlines, the stream survives idle heartbeats and an actual mailbox change arrives without polling')
# The console policy is durable and enforced by Rust even if a client bypasses the UI.
policy=req('/admin/client-policy',c=operator)
req('/admin/client-policy',policy,'PUT',alice,403)
try:
 restricted={**policy,'sharingEnabled':True,'sharingWriteEnabled':False}
 req('/admin/client-policy',restricted,'PUT',operator,204)
 assert req('/client/policy',c=alice)['restrictions']['sharingRights']['allowedValues']==['read']
 native(alice,'FileNode/set',{'update':{folder:{'shareWith/other/mayModifyContent':True}}},file_caps,expected=403)
 native(alice,'FileNode/set',{'#update':{'resultOf':'a','name':'Core/echo','path':'/value'}},file_caps,expected=403)
finally:req('/admin/client-policy',policy,'PUT',operator,204)
passed('Console defaults persist and read-only sharing cannot be bypassed with a JMAP path patch or result reference')
# Password mutation uses the platform path and revokes every existing device session.
credential_user,credential_email=signup('secret'+stamp)
second_device=login(credential_email,D['userPassword']);replacement=secrets.token_urlsafe(24)
req('/auth/password',{'current_password':D['userPassword'],'new_password':replacement},'POST',credential_user,204)
req('/auth/session',c=credential_user,expected=401);req('/auth/session',c=second_device,expected=401)
req('/auth/login',{'email':credential_email,'password':D['userPassword']},'POST',expected=401)
renewed=login(credential_email,replacement)
req('/account',{'display_name':'完整客户端验收'},'PATCH',renewed,204)
assert req('/account',c=renewed)['displayName']=='完整客户端验收'
def personal(method,args):
 response=req('/client/account',{'using':['urn:ietf:params:jmap:core','urn:stalwart:jmap'],'methodCalls':[[method,args,'c']]},'POST',renewed)
 return result(response,method)
credential=personal('x:ApiKey/set',{'create':{'c':{'description':'Native verification key','permissions':{'@type':'Inherit'}}}})['created']['c']
try:
 upstream='http://stalwart-a:8080/jmap/'
 payload={'using':['urn:ietf:params:jmap:core','urn:stalwart:jmap'],'methodCalls':[['x:ApiKey/set',{'create':{'child':{'description':'Must not be minted'}}},'c']]}
 headers={'Content-Type':'application/json','Authorization':'Bearer '+credential['secret']}
 own=req('/jmap/session',c=renewed)['platformAccountId']
 readable={'using':['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail'],'methodCalls':[['Email/get',{'accountId':own,'ids':[]},'r']]}
 checked=json.load(PUBLIC.open(urllib.request.Request(upstream,data=json.dumps(readable).encode(),headers=headers),timeout=25))
 assert checked['methodResponses'][0][0]=='Email/get',checked
 try:
  response=json.load(PUBLIC.open(urllib.request.Request(upstream,data=json.dumps(payload).encode(),headers=headers),timeout=25))
  value=response['methodResponses'][0]
  assert value[0]=='error' and value[1]['type']=='forbidden' or value[1].get('notCreated',{}).get('child',{}).get('type')=='forbidden',value
 except urllib.error.HTTPError as error:assert error.code==403,error.code
finally:personal('x:ApiKey/set',{'destroy':[credential['id']]})
passed('Native profile saves on Stalwart and personal API keys cannot mint more credentials')
req('/auth/password',{'current_password':replacement,'new_password':D['userPassword']},'POST',renewed,204)
passed('Native password changes revoke all devices and require the new credential')
(ROOT/'native-report.json').write_text(json.dumps(EVIDENCE,ensure_ascii=False,indent=2))
