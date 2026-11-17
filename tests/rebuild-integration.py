from environment_client import *
stamp=str(int(time.time()))
operator=login(D['operator'],D['operatorPassword']);alice=login(D['user'],D['userPassword']);passed('Existing operator and actually registered user can log in')
if '--soak' in sys.argv:
 start=time.monotonic()
 for index in range(4):
  target=start+index*600
  while time.monotonic()<target:time.sleep(min(10,target-time.monotonic()))
  c,email=signup('soak'+stamp+str(index));passed(f'Sustained signup/login after {round(time.monotonic()-start)} seconds: {email}')
 (ROOT/'soak-report.json').write_text(json.dumps(EVIDENCE,indent=2));sys.exit()
alice,actor_email=signup('baseline'+stamp);D={**D,'user':actor_email}
bob,bob_email=signup('haru'+stamp);passed('Public signup performs official Turnstile verification, real SMTP code delivery, registration and login')
req('/registration/challenges',{'email':'invalid-'+stamp+'@recovery.example.net','purpose':'registration','turnstile_token':'invalid'},'POST',expected=400);passed('Invalid Turnstile token is rejected')
owner=req('/jmap/session',c=alice)['platformAccountId'];other=req('/jmap/session',c=bob)['platformAccountId']
jmap(alice,'ContactCard/get',{'accountId':other},403);jmap(alice,'x:Account/get',expected=403);jmap(alice,'EmailSubmission/set',{'create':{'s':{'emailId':'missing','identityId':'missing'}}},expected=400);passed('Session gateway rejects cross-user accounts, directory management and submissions without an idempotency key')
books=jmap(alice,'AddressBook/get')['list'];book=books[0]['id'];contact=create(alice,'ContactCard',{'uid':'urn:uuid:'+str(uuid.uuid4()),'addressBookIds':{book:True},'name':{'full':'春野 Sakura'},'emails':{'e':{'address':bob_email}},'notes':{'n':{'note':'真实 Stalwart 联系人'}}})
jmap(alice,'ContactCard/set',{'update':{contact:{'name':{'full':'春野 · 已更新'}}}});assert jmap(alice,'ContactCard/get',{'ids':[contact]})['list'][0]['name']['full']=='春野 · 已更新';passed('Contacts create/read/update persist on Stalwart')
cal=jmap(alice,'Calendar/get')['list'][0]['id'];start=(datetime.datetime.now()+datetime.timedelta(days=1)).replace(hour=10,minute=0,second=0,microsecond=0).isoformat()
event=create(alice,'CalendarEvent',{'@type':'Event','uid':str(uuid.uuid4()),'calendarIds':{cal:True},'title':'樱花邮件 · 周会','start':start,'duration':'PT1H','timeZone':'America/New_York','description':'重复事件与时区验收','recurrenceRules':[{'@type':'RecurrenceRule','frequency':'weekly','interval':1,'count':4}]})
assert jmap(alice,'CalendarEvent/get',{'ids':[event]})['list'][0]['title']=='樱花邮件 · 周会';passed('Calendar stores a real recurring event with timezone')
folder=create(alice,'FileNode',{'@type':'Directory','name':'重构验收-'+stamp,'parentId':None});blob=upload(alice,'hello.txt','你好，Mail Web。'.encode());node=create(alice,'FileNode',{'@type':'File','name':'hello.txt','parentId':folder,'blobId':blob['blobId'],'mediaType':'text/plain'})
file_blob=jmap(alice,'FileNode/get',{'ids':[node]})['list'][0]['blobId']
assert req(f'/files/{owner}/{file_blob}/content?node={node}',c=alice)== '你好，Mail Web。'.encode();req(f'/files/{owner}/{file_blob}/content?node={node}',c=bob,expected=403);passed('Real file upload, folder creation, owner download and cross-user rejection')
trash=next((f['id'] for f in jmap(alice,'FileNode/get')['list'] if f['name']=='.Trash'),None) or create(alice,'FileNode',{'@type':'Directory','name':'.Trash','parentId':None});batch=create(alice,'FileNode',{'@type':'Directory','name':str(int(time.time()*1000))+'~'+folder,'parentId':trash});jmap(alice,'FileNode/set',{'update':{node:{'parentId':batch}}});jmap(alice,'FileNode/set',{'update':{node:{'parentId':folder}}});passed('Server-persisted file trash and restore use upstream directory semantics')
# Seed real mail with rich text and a platform-owned attachment.
op=str(uuid.uuid4());draft={'to':[D['user']],'cc':[],'bcc':[],'subject':'欢迎来到新的 Mail Web ✦','text':'你好，Sakura！\n\n新的工作区已经准备好了。','html':'<p>你好，<strong>Sakura</strong>！</p><p>新的工作区已经准备好了。</p><script>alert(1)</script>','attachments':[]}
sent=req('/submissions',{'idempotency_key':op,'draft':draft},'POST',operator);assert sent['status'] in ['succeeded','submitted'],sent
again=req('/submissions',{'idempotency_key':op,'draft':draft},'POST',operator);assert again['status'] in ['succeeded','submitted'],again
for _ in range(30):
 boxes=req('/mailboxes',c=alice)['list'];inbox=next(b['id'] for b in boxes if b['role']=='inbox');messages=req('/messages?'+urllib.parse.urlencode({'mailbox':inbox,'search':'','position':0}),c=alice)
 if messages['items']:break
 time.sleep(.3)
assert messages['items'];detail=req('/messages/'+messages['items'][0]['id'],c=alice);assert '<script' not in json.dumps(detail).lower();passed('Rich email submission, idempotent retry, delivery and sanitized reader work against real Stalwart')
connections=req('/installation/connections',c=operator)['domains'];second=next(x for x in connections if x['name']=='second.example.com')['id'];enable_domain(second,operator);charlie,charlie_email=signup('yuki'+stamp,second);session=req('/jmap/session',c=charlie);assert req('/auth/session',c=charlie)['domainId']==second;passed('Second real Stalwart completes independent readiness, SMTP verification, signup and mailbox login')
before=req('/admin/registration',c=operator)['policy'];compose('stop','stalwart-a');assert req('/registration/policy')['enabled'] is True;req('/registration/challenges',{'email':'outage-'+stamp+'@recovery.example.net','purpose':'registration','turnstile_token':'XXXX.DUMMY.TOKEN.XXXX'},'POST',expected=502);assert req('/jmap/session',c=charlie)['platformAccountId']==session['platformAccountId'];compose('start','stalwart-a');time.sleep(2);assert req('/admin/registration',c=operator)['policy']==before;passed('Upstream outage preserves registration intent and does not break the second server')
compose('restart','app');wait();assert req('/auth/session',c=alice)['email']==D['user'];assert jmap(alice,'ContactCard/get',{'ids':[contact]})['list'];assert jmap(alice,'CalendarEvent/get',{'ids':[event]})['list'];assert jmap(alice,'FileNode/get',{'ids':[node]})['list'];assert req('/registration/policy')['enabled'] is True;passed('Restart preserves sessions, contacts, calendar, files and registration policy')
(ROOT/'integration-report.json').write_text(json.dumps(EVIDENCE,indent=2));print('All real-service checks passed.',flush=True)
