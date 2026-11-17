"""Exercise official negative test secrets only in an independent restored stack."""
import datetime,json,pathlib,time,urllib.parse,urllib.request,uuid

DOC='https://developers.cloudflare.com/turnstile/troubleshooting/testing/'
DUMMY='XXXX.DUMMY.TOKEN.XXXX'

def verify(env,operator):
    assert urllib.parse.urlparse(env.BASE).port!=env.D['port'],'Refusing the primary test stack'
    original=env.req('/installation/config',c=operator)['settings']
    assert original['turnstileSiteKey']=='1x00000000000000000000AA'
    policy=env.req('/admin/registration',c=operator)['policy']
    results=[]
    try:
        for label,prefix,expected_error in [('failure','2','invalid-input-response'),('duplicate','3','timeout-or-duplicate'),('success','1',None)]:
            secret=prefix+'x0000000000000000000000000000000AA'
            # Publicly documented dummy secrets; never send saved deployment secrets.
            request=urllib.request.Request('https://challenges.cloudflare.com/turnstile/v0/siteverify',data=urllib.parse.urlencode({'secret':secret,'response':DUMMY}).encode())
            provider=json.load(env.PUBLIC.open(request,timeout=25))
            assert provider['success']==(expected_error is None),provider
            if expected_error:assert expected_error in provider.get('error-codes',[]),provider
            env.req('/installation/config',{**original,'turnstileSecret':secret},'PUT',operator)
            time.sleep(1)
            env.wait()
            report=env.req('/installation/readiness',{},'POST',operator)
            assert all(i['status']=='passed' for i in report['items']),report
            link=env.req('/installation/readiness/link',{},'POST',operator)['url']
            ticket=urllib.parse.parse_qs(urllib.parse.urlparse(link).fragment)['check'][0]
            receiver='captcha-'+label+'-'+uuid.uuid4().hex[:8]+'@recovery.example.net'
            response=env.req('/readiness/send',{'ticket':ticket,'email':receiver,'turnstile_token':DUMMY},'POST',expected=400 if expected_error else 200)
            if expected_error:
                assert response.get('code')=='captcha_invalid',response
                inbox=json.load(env.PUBLIC.open(env.MAIL+'/api/v1/search?query='+urllib.parse.quote('to:'+receiver)))
                assert not inbox.get('messages'),inbox
            else:
                env.req('/readiness/verify',{'ticket':ticket,'code':env.mail_code(receiver)},'POST')
            assert env.req('/admin/registration',c=operator)['policy']==policy
            results.append({'case':label,'officialProviderSuccess':provider['success'],'officialProviderErrors':provider.get('error-codes',[]),'applicationStatus':400 if expected_error else 200,'actualSmtpVerification':expected_error is None,'registrationPolicyPreserved':True})
            print('PASS: official Turnstile '+label+' response handled by restored application; registration policy preserved',flush=True)
    finally:
        # The original test secret is public and fixed; saved private credentials remain untouched.
        env.req('/installation/config',{**original,'turnstileSecret':'1x0000000000000000000000000000000AA'},'PUT',operator)
    proof={'scope':'independent restored local Docker stack only; main soak and production configuration unchanged','documentation':DOC,'passed':True,'cases':results,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (env.ROOT/'turnstile-report.json').write_text(json.dumps(proof,indent=2)+'\n')

def verify_production_guard(env):
    assert urllib.parse.urlparse(env.BASE).port!=env.D['port'],'Refusing the primary test stack'
    receiver='captcha-production-guard-'+uuid.uuid4().hex[:8]+'@recovery.example.net'
    response=env.req('/registration/challenges',{'email':receiver,'purpose':'registration','domainId':'default','turnstile_token':DUMMY},'POST',expected=503)
    assert response.get('code')=='verification_test_keys_forbidden',response
    proof=env.ROOT/'turnstile-report.json';report=json.loads(proof.read_text());report['productionModeRejectsTestKeys']=True;proof.write_text(json.dumps(report,indent=2)+'\n')
    print('PASS: production-mode restored application rejects official test keys before verification or SMTP',flush=True)
