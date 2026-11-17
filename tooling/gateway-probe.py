"""Disposable official-Stalwart protocol probe for the independent gateway.
Uses a separate Compose project and loopback ports; never selects the rebuild or business stack.
"""
import base64,email.parser,email.policy,json,os,pathlib,secrets,smtplib,socket,subprocess,sys,time,urllib.request,urllib.parse,uuid
root=pathlib.Path(__file__).resolve().parents[1]/'.cache/gateway-probe';root.mkdir(parents=True,exist_ok=True);root.chmod(0o700)
settings=root/'settings.json'
if not settings.exists():
 ports=[]
 for _ in range(3):
  with socket.socket() as s:s.bind(('127.0.0.1',0));ports.append(s.getsockname()[1])
 d={'admin':secrets.token_hex(24),'password':secrets.token_urlsafe(24),'ports':ports};settings.write_text(json.dumps(d));settings.chmod(0o600)
d=json.loads(settings.read_text());http,smtp,mail=d['ports'];base='http://127.0.0.1:'+str(http);sink='http://127.0.0.1:'+str(mail)
env=root/'compose.env';env.write_text('PROBE_ROOT='+str(root)+'\nPROBE_ADMIN='+d['admin']+'\nPROBE_HTTP_PORT='+str(http)+'\nPROBE_SMTP_PORT='+str(smtp)+'\nPROBE_MAIL_PORT='+str(mail)+'\n');env.chmod(0o600)
compose=root/'compose.yaml';compose.write_text('''services:
  stalwart:
    image: stalwartlabs/stalwart:v1.0.1-alpine
    environment:
      STALWART_PUBLIC_URL: http://stalwart:8080
      STALWART_RECOVERY_ADMIN: bootstrap:${PROBE_ADMIN}
    volumes: ['${PROBE_ROOT}/etc:/etc/stalwart','${PROBE_ROOT}/data:/var/lib/stalwart']
    ports: ['127.0.0.1:${PROBE_HTTP_PORT}:8080','127.0.0.1:${PROBE_SMTP_PORT}:25']
  sink:
    image: axllent/mailpit:v1.27
    ports: ['127.0.0.1:${PROBE_MAIL_PORT}:8025']
''')
for name in ['etc','data']:
 p=root/name;p.mkdir(exist_ok=True);os.chown(p,2000,2000)
def dc(*args):subprocess.run(['docker','compose','-p','mailweb-gateway-probe','--env-file',str(env),'-f',str(compose),*args],check=True,stdout=subprocess.DEVNULL)
if len(sys.argv)>1 and sys.argv[1]=='down':dc('down');sys.exit()
dc('up','-d');op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def request(url,body=None,auth=None,kind='application/json'):
 data=json.dumps(body).encode() if isinstance(body,dict) else body
 req=urllib.request.Request(url,data=data,headers={'Content-Type':kind,**({'Authorization':auth} if auth else {})})
 with op.open(req,timeout=20) as r:
  raw=r.read();return json.loads(raw) if 'json' in r.headers.get('Content-Type','') else raw
for _ in range(100):
 try:request(base+'/healthz/live');break
 except OSError:time.sleep(.3)
else:raise RuntimeError('Probe server unavailable')
admin='Basic '+base64.b64encode(('bootstrap:'+d['admin']).encode()).decode()
def rpc(method,args,auth=admin):
 result=request(base+'/jmap/',{'using':['urn:ietf:params:jmap:core','urn:stalwart:jmap','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:sieve','urn:ietf:params:jmap:vacationresponse'],'methodCalls':[[method,args,'p']]},auth)['methodResponses'][0]
 if result[0]!=method or any(result[1].get(k) for k in ['notCreated','notUpdated','notDestroyed']):
  raise RuntimeError('Probe rejected '+method+': '+json.dumps(result[1])[:700])
 return result[1]
def save():settings.write_text(json.dumps(d));settings.chmod(0o600)
if not d.get('bootstrapped'):
 rpc('x:Bootstrap/set',{'update':{'singleton':{'defaultDomain':'probe.example.com','defaultHostname':'mx.probe.example.com','requestTlsCertificate':False,'generateDkimKeys':False,'tracer':{'@type':'Stdout','ansi':False}}}});d['bootstrapped']=True;save();dc('restart','stalwart');time.sleep(1)
 for _ in range(100):
  try:rpc('Core/echo',{});break
  except OSError:time.sleep(.2)
def domain(name):
 existing=next((r for r in rpc('x:Domain/get',{})['list'] if r['name']==name),None)
 return existing['id'] if existing else rpc('x:Domain/set',{'create':{'d':{'name':name,'description':'mail-web gateway probe','certificateManagement':{'@type':'Manual'},'dkimManagement':{'@type':'Manual'},'dnsManagement':{'@type':'Manual'}}}})['created']['d']['id']
primary=domain('probe.example.com');proof='owner.proof.probe.example.com';proof_id=domain(proof)
if not d.get('owner'):
 d['owner']=rpc('x:Account/set',{'create':{'u':{'@type':'User','name':'owner','domainId':primary,'description':'Gateway probe owner','roles':{'@type':'User'},'credentials':{'0':{'@type':'Password','secret':d['password']}}}}})['created']['u']['id'];save()
if not d.get('signer'):
 pem=subprocess.check_output(['openssl','genpkey','-algorithm','ED25519']);(root/'proof-private.pem').write_bytes(pem);(root/'proof-private.pem').chmod(0o600)
 pub=subprocess.check_output(['openssl','pkey','-pubout'],input=pem);(root/'proof-public.pem').write_bytes(pub)
 d['signer']=rpc('x:DkimSignature/set',{'create':{'s':{'@type':'Dkim1Ed25519Sha256','domainId':proof_id,'selector':'mw-proof','privateKey':{'@type':'Text','secret':pem.decode()},'headers':{k:True for k in ['From','To','Subject','Date','Message-ID','MIME-Version','Content-Type']}}}})['created']['s']['id'];save()
routes=rpc('x:MtaRoute/get',{})['list'];route=next((r for r in routes if r['name']=='probe-sink'),None)
if not route:rpc('x:MtaRoute/set',{'create':{'r':{'@type':'Relay','name':'probe-sink','host':'sink','port':1025,'protocol':'smtp','implicitTls':False,'allowInvalidCerts':False}}})
rpc('x:MtaOutboundStrategy/set',{'update':{'singleton':{'route':{'match':{'0':{'if':'is_local_domain(rcpt_domain)','then':"'local'"}},'else':"'probe-sink'"}}}})
current=rpc('x:SieveUserInterpreter/get',{'ids':['singleton']})['list'][0]
patch={'dkimSignDomain/else':"'"+proof+"'"}
patch.update({'dkimSignDomain/match/'+k:None for k in current.get('dkimSignDomain',{}).get('match',{})})
rpc('x:SieveUserInterpreter/set',{'update':{'singleton':patch}})
rpc('x:Action/set',{'create':{'r':{'@type':'ReloadSettings'}}})
user='owner@probe.example.com';auth='Basic '+base64.b64encode((user+':'+d['password']).encode()).decode();session=request(base+'/jmap/session',auth=auth);account=session['primaryAccounts']['urn:ietf:params:jmap:mail'];stamp=uuid.uuid4().hex[:8]
script=('require ["vacation", "copy"]; vacation :days 1 :from "Other <forged@outside.example.net>" "Gateway proof '+stamp+'"; redirect :copy "copy-'+stamp+'@receiver.example.net"; keep;').encode()
url=session['uploadUrl'].replace('http://stalwart:8080',base).replace('{accountId}',account)
blob=request(url,script,auth,'application/sieve')['blobId'];rpc('SieveScript/set',{'accountId':account,'create':{'p':{'name':'gateway-probe-'+stamp,'blobId':blob}},'onSuccessActivateScript':'#p'},auth)
with smtplib.SMTP('127.0.0.1',smtp,timeout=20) as client:client.sendmail('sender-'+stamp+'@outside.example.net',[user],('From: sender-'+stamp+'@outside.example.net\r\nTo: '+user+'\r\nSubject: Gateway ownership '+stamp+'\r\nMessage-ID: <'+stamp+'@outside.example.net>\r\n\r\nProbe content\r\n').encode())
for _ in range(120):
 messages=request(sink+'/api/v1/search?query='+urllib.parse.quote(stamp)).get('messages',[])
 if len(messages)>=2:break
 time.sleep(.25)
else:raise RuntimeError('Autogenerated probe messages did not arrive')
proofs=[]
for item in messages:
 raw=request(sink+'/api/v1/message/'+item['ID']+'/raw');parsed=email.parser.BytesParser(policy=email.policy.default).parsebytes(raw)
 sig=parsed.get('DKIM-Signature','');assert ('d='+proof) in ''.join(str(sig).split()), 'Owner proof missing: '+str(sig)
 name='vacation' if str(parsed.get('Auto-Submitted',''))=='auto-replied' else 'redirect';(root/(name+'.eml')).write_bytes(raw)
 proofs.append({'kind':name,'from':str(parsed.get('From','')),'proofDomain':proof})
(root/'proof-report.json').write_text(json.dumps({'officialStalwart':'1.0.1','checks':proofs},indent=2));print('PASS: official Stalwart signs both redirect and null-sender vacation with the owning account proof, even with a forged vacation From header')
# Prove reinjection can preserve null reverse-path and sign with the real domain.
if not d.get('realSigner'):
 pem=subprocess.check_output(['openssl','genpkey','-algorithm','ED25519'])
 d['realSigner']=rpc('x:DkimSignature/set',{'create':{'s':{'@type':'Dkim1Ed25519Sha256','domainId':primary,'selector':'mw-real','privateKey':{'@type':'Text','secret':pem.decode()},'headers':{k:True for k in ['From','To','Subject','Date','Message-ID','MIME-Version','Content-Type']}}}})['created']['s']['id'];save()
if not d.get('relay'):
 d['relayPassword']=secrets.token_urlsafe(32);save()
 d['relay']=rpc('x:Account/set',{'create':{'u':{'@type':'User','name':'gateway-relay','domainId':primary,'description':'mail-web gateway probe relay','roles':{'@type':'User'},'credentials':{'0':{'@type':'Password','secret':d['relayPassword']}}}}})['created']['u']['id'];save()
relay='gateway-relay@probe.example.com'
def prepend(method,field,condition,then,override_else=None):
 current=rpc(method+'/get',{'ids':['singleton']})['list'][0][field]
 matches=current.get('match',{});patch={field+'/match/'+k:None for k in matches}
 patch[field+'/match/0']={'if':condition,'then':then}
 for n,(_,v) in enumerate(sorted(matches.items()),1):patch[field+'/match/'+str(n)]=v
 if override_else is not None:patch[field+'/else']=override_else
 rpc(method+'/set',{'update':{'singleton':patch}})
# Probe-only SMTP plaintext credentials stay on this disposable private network.
rpc('x:MtaStageAuth/set',{'update':{'singleton':{'saslMechanisms':{'else':'[plain]'}}}})
prepend('x:MtaStageAuth','mustMatchSender',"authenticated_as == '"+relay+"'",'false')
prepend('x:MtaStageData','dkimSignDomain',"authenticated_as == '"+relay+"' && is_local_domain(helo_domain)",'helo_domain')
rpc('x:Action/set',{'create':{'r':{'@type':'ReloadSettings'}}})
raw=(root/'vacation.eml').read_bytes();parsed=email.parser.BytesParser(policy=email.policy.default).parsebytes(raw)
# Strip only the private proof, keeping all original message header/body bytes.
lines=raw.splitlines(keepends=True);out=[];skip=False;in_headers=True
for line in lines:
 if in_headers:
  if line in [b'\r\n',b'\n']:in_headers=False;skip=False
  elif not line.startswith((b' ',b'\t')):skip=line.lower().startswith(b'dkim-signature:')
 if not skip:out.append(line)
forward=b''.join(out)
with smtplib.SMTP('127.0.0.1',smtp,timeout=20) as client:
 client.ehlo('probe.example.com');client.login(relay,d['relayPassword']);client.sendmail('', ['relay-'+stamp+'@receiver.example.net'],forward)
for _ in range(120):
 matches=request(sink+'/api/v1/search?query='+urllib.parse.quote(stamp)).get('messages',[])
 matches=[m for m in matches if 'd=probe.example.com;' in ''.join(str(email.parser.BytesParser(policy=email.policy.default).parsebytes(request(sink+'/api/v1/message/'+m['ID']+'/raw')).get('DKIM-Signature','')).split())]
 if matches:break
 time.sleep(.25)
else:raise RuntimeError('Reinjected vacation did not arrive')
raw=request(sink+'/api/v1/message/'+matches[0]['ID']+'/raw');parsed=email.parser.BytesParser(policy=email.policy.default).parsebytes(raw)
assert 'd=probe.example.com;' in ''.join(str(parsed.get('DKIM-Signature','')).split()), 'Real-domain signature missing after authenticated reinjection'
(root/'reinjected-vacation.eml').write_bytes(raw)
print('PASS: official SMTP authenticated reinjection preserves null sender and signs with the owner real domain selected through EHLO')
# Validate a server-only scoped credential can adapt native rule writes without
# granting a user's direct protocols a path around gateway readiness checks.
rights={'authenticate':True,'impersonate':True,'jmapSieveScriptCreate':True,'jmapSieveScriptUpdate':True,'jmapSieveScriptDestroy':True,'jmapVacationResponseUpdate':True}
rpc('x:Account/set',{'update':{d['relay']:{'permissions':{'@type':'Merge','enabledPermissions':rights}}}})
relay_auth='Basic '+base64.b64encode((relay+':'+d['relayPassword']).encode()).decode()
key=rpc('x:ApiKey/set',{'create':{'k':{'description':'private-gateway-probe','permissions':{'@type':'Replace','permissions':rights}}}},relay_auth)['created']['k']
try:
 rpc('VacationResponse/set',{'accountId':account,'update':{'singleton':{'isEnabled':True,'textBody':'Gateway adapter probe','subject':'Gateway adapter probe'}}},'Bearer '+key['secret'])
 print('PASS: scoped server-only Impersonate credential updates the verified mailbox vacation response')
finally:rpc('x:ApiKey/set',{'destroy':[key['id']]},relay_auth)
