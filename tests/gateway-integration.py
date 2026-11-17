"""Independent gateway against two unmodified official Stalwarts; no DB seeding."""
from environment_client import *
import email.parser,email.policy,smtplib

operator=login(D['operator'],D['operatorPassword']);stamp=uuid.uuid4().hex[:8]
domains=req('/registration/domains')['items'];second=next(d['id'] for d in domains if d['domain']=='second.example.com')
if not next(d for d in domains if d['id']==second)['enabled']:enable_domain(second,operator)
owners=[];relay_restore=[]
def admin(which,method,args):
 url='http://stalwart-'+which.lower()+':8080/jmap/'
 auth='Basic '+base64.b64encode(('bootstrap:'+D['admin'+which]).encode()).decode()
 body={'using':['urn:ietf:params:jmap:core','urn:stalwart:jmap'],'methodCalls':[[method,args,'g']]}
 request=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Authorization':auth,'Content-Type':'application/json'})
 result=json.load(PUBLIC.open(request,timeout=25))['methodResponses'][0]
 assert result[0]==method,(method,result[0])
 for key in ['notCreated','notUpdated','notDestroyed']:assert not result[1].get(key),(method,result[1].get(key))
 return result[1]
def call(owner,method,args):
 body={'using':['urn:ietf:params:jmap:core','urn:ietf:params:jmap:sieve','urn:ietf:params:jmap:vacationresponse'],'methodCalls':[[method,{'accountId':owner['account'],**args},'g']]}
 value=req('/jmap',body,'POST',owner['client'])['methodResponses'][0]
 assert value[0]==method,value
 for key in ['notCreated','notUpdated','notDestroyed']:assert not value[1].get(key),value
 return value[1]
def inject(owner,label):
 tag=stamp+'-'+owner['which']+'-'+label
 sender='sender-'+tag+'@outside.example.net'
 raw=('From: '+sender+'\r\nTo: '+owner['email']+'\r\nSubject: Gateway '+tag+'\r\nMessage-ID: <'+tag+'@outside.example.net>\r\n\r\nGateway integration '+tag+'\r\n').encode()
 with smtplib.SMTP('stalwart-'+owner['which'].lower(),25,timeout=25) as smtp:smtp.sendmail(sender,[owner['email']],raw)
 return tag
def sink_messages(tag):
 messages=json.load(PUBLIC.open(MAIL+'/api/v1/search?query='+urllib.parse.quote(tag),timeout=10)).get('messages',[])
 return [email.parser.BytesParser(policy=email.policy.default).parsebytes(PUBLIC.open(MAIL+'/api/v1/message/'+m['ID']+'/raw',timeout=10).read()) for m in messages]
def await_count(owner,count):
 for _ in range(160):
  usage=req('/account/usage',c=owner['client'])
  if usage['dailyRecipientsUsed']==count:return
  time.sleep(.25)
 raise AssertionError(('Gateway count did not converge',owner['which'],usage,count))
def queued(owner):
 return [m for m in admin(owner['which'],'x:QueuedMessage/get',{})['list'] if any(stamp in recipient for recipient in m.get('recipients',{}))]
def retry(owner):
 now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
 messages=queued(owner)
 if messages:admin(owner['which'],'x:QueuedMessage/set',{'update':{m['id']:{'nextRetry':now} for m in messages}})
def wait_login(owner):
 for _ in range(30):
  try:return login(owner["email"],D["userPassword"])
  except AssertionError:time.sleep(.5)
 raise AssertionError("Account policy did not become active")
def limits(owner,amount,enabled=True):
 req('/admin/users/'+owner['userId'],{'enabled':enabled,'quota_bytes':1073741824,'hourly_recipients':amount,'daily_recipients':amount},'PATCH',operator,202)
try:
 for which,domain in [('A','default'),('B',second)]:
  client,email_address=signup('gw'+stamp+which.lower(),domain)
  session=req('/jmap/session',c=client);user=req('/auth/session',c=client)
  owner={'which':which,'domain':domain,'client':client,'email':email_address,'account':session['platformAccountId'],'userId':user['id']};owners.append(owner)
  assert req('/client/automatic-mail',c=client)['status']=='ready'
  call(owner,'VacationResponse/set',{'update':{'singleton':{'isEnabled':True,'textBody':'Private adapter '+stamp}}})
  call(owner,'VacationResponse/set',{'update':{'singleton':{'isEnabled':False}}})
  script=('require ["vacation", "copy"]; vacation :days 1 :from "Forged <forged@foreign.example.net>" "Gateway vacation '+stamp+'-'+which+'"; redirect :copy "copy-'+stamp+'-'+which+'@receiver.example.net"; keep;').encode()
  blob=req('/jmap/upload/'+owner['account'],method='POST',c=client,raw=script,kind='application/sieve')['blobId']
  result=call(owner,'SieveScript/set',{'create':{'rule':{'name':'Gateway '+stamp,'blobId':blob}},'onSuccessActivateScript':'#rule'});owner['script']=result['created']['rule']['id']
  # A browser may not elevate a rule batch for a different account or mix email sends into it.
  req('/jmap',{'using':['urn:ietf:params:jmap:core','urn:ietf:params:jmap:sieve'],'methodCalls':[['SieveScript/set',{'accountId':'foreign','update':{}},'g']]},'POST',client,403)
  limits(owner,3 if which=='A' else 20)
  owner['first']=inject(owner,'first');await_count(owner,2)
  for _ in range(120):
   messages=sink_messages(owner['first'])
   if len(messages)>=2:break
   time.sleep(.25)
  else:raise AssertionError('Gateway accepted messages did not reach the real SMTP receiver')
  assert any('forged@foreign.example.net' in str(m.get('From','')) for m in messages)
  assert all('.g' not in ''.join(str(m.get('DKIM-Signature','')).split()) or 'mw-proof' not in str(m.get('DKIM-Signature','')) for m in messages),'Private ownership signature leaked'
 passed('Both official Stalwarts deliver real Sieve redirects and forged-From null-sender vacations through the gateway; each owner uses exactly two shared quota units')
 a,b=owners
 # A failed management probe must not become a new registration switch.
 directories=admin('B','x:Account/get',{'properties':['id','name','description','permissions']})['list']
 directory=next(r for r in directories if r.get('description','').endswith(':directory'))
 relay_restore.append(('B',directory['id'],directory['permissions']))
 broken=json.loads(json.dumps(directory['permissions']));broken.setdefault('disabledPermissions',{})['sysDkimSignatureGet']=True
 admin('B','x:Account/set',{'update':{directory['id']:{'permissions':broken}}})
 pending_client,pending_email=signup('gwproof'+stamp+'b',second)
 assert req('/auth/session',c=pending_client)['email']==pending_email
 assert next(d for d in req('/registration/domains')['items'] if d['id']==second)['enabled'] is True
 admin('B','x:Account/set',{'update':{directory['id']:{'permissions':directory['permissions']}}});relay_restore.clear()
 pending_account=req('/jmap/session',c=pending_client)['platformAccountId']
 pending_owner={'client':pending_client,'account':pending_account}
 pending_blob=req('/jmap/upload/'+pending_account,method='POST',c=pending_client,raw=b'keep;',kind='application/sieve')['blobId']
 call(pending_owner,'SieveScript/set',{'create':{'recovered':{'name':'Recovered probe '+stamp,'blobId':pending_blob}}})
 passed('A failing gateway management probe does not close registration or prevent actual signup/login; after the dependency recovers rule creation resumes without reconfiguring the app')
 relays=admin('B','x:Account/get',{'properties':['id','name','description','permissions']})['list']
 relay=next(r for r in relays if r.get('description','').startswith('mail-web:gateway:') and r['name'].startswith('mw-gateway-'))
 relay_restore.append(('B',relay['id'],relay['permissions']))
 admin('B','x:Account/set',{'update':{relay['id']:{'permissions':{'@type':'Replace','enabledPermissions':{'authenticate':True},'disabledPermissions':{'emailSend':True}}}}})
 outage=inject(b,'relay-outage');await_count(b,4)
 for _ in range(120):
  pending=[r for r in req('/client/automatic-mail',c=b['client'])['items'] if r['status']=='queued' and r['error']=='smtp_temporarily_unavailable']
  if len(pending)>=2:break
  time.sleep(.25)
 else:raise AssertionError('Relay failure did not leave two durably queued automatic messages')
 pending_ids={r['id'] for r in pending};compose('restart','app');wait()
 after={r['id']:r for r in req('/client/automatic-mail',c=b['client'])['items']}
 assert pending_ids.issubset(after),'Gateway spool was lost on restart'
 admin('B','x:Account/set',{'update':{relay['id']:{'permissions':relay['permissions']}}});relay_restore.clear()
 req('/admin/tasks/retry?domainId='+second,{},'POST',operator)
 for _ in range(160):
  after={r['id']:r for r in req('/client/automatic-mail',c=b['client'])['items']}
  if all(after[i]['status']=='delivered' for i in pending_ids) and len(sink_messages(outage))>=2:break
  time.sleep(.25)
 else:raise AssertionError('Durable automatic mail did not recover after the relay became available')
 assert req('/account/usage',c=b['client'])['dailyRecipientsUsed']==4
 passed('A real upstream relay refusal leaves encrypted durable messages; restarting only the isolated app preserves them, and recovery delivers them without counting twice')
 tag=inject(a,'limit');await_count(a,3)
 for _ in range(120):
  pending=queued(a)
  if pending and '451' in json.dumps(pending):break
  time.sleep(.25)
 else:raise AssertionError('Quota exhaustion did not produce a retryable official-server queue entry')
 assert req('/account/usage',c=b['client'])['dailyRecipientsUsed']==4
 limits(a,10);retry(a);await_count(a,4)
 passed('Automatic mail stops at the shared quota, remains retryable upstream, and resumes after an API quota change without reconfiguration or double counting; second-server counters stay isolated')
 limits(a,10,False);inject(a,'disabled')
 for _ in range(100):
  if queued(a):break
  time.sleep(.25)
 else:raise AssertionError('Disabled-owner automatic mail did not remain queued')
 limits(a,10,True);a['client']=wait_login(a);retry(a);await_count(a,6)
 passed('Disabling the owning mailbox blocks automatic sends even when the vacation From names someone else; re-enabling resumes the same queued messages')
 for owner in owners:
  records=req('/client/automatic-mail',c=owner['client'])
  assert records['configured'] and records['items']
  ids={i['id'] for i in records['items']};other=owners[1] if owner is owners[0] else owners[0]
  assert not ids.intersection(i['id'] for i in req('/client/automatic-mail',c=other['client'])['items'])
 passed('Personal automatic-mail records are account-isolated and the unified console exposes the selected service queue')
finally:
 for which,account_id,permissions in relay_restore:
  admin(which,'x:Account/set',{'update':{account_id:{'permissions':permissions}}})
 for owner in owners:
  try:
   limits(owner,100,True)
   owner['client']=wait_login(owner)
   if owner.get('script'):call(owner,'SieveScript/set',{'onSuccessDeactivateScript':True})
  except Exception as error:print('Cleanup requires retry:',owner['which'],type(error).__name__,flush=True)
(ROOT/'gateway-report.json').write_text(json.dumps(EVIDENCE,indent=2))
