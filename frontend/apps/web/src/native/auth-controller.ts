'use client';
import {useEffect,useRef,useState} from 'react';
import Script from 'next/script';

import {Action} from '@mail-web/ui/action';
import {TextField,PasswordField,SelectField} from '@mail-web/ui/form-field';
import {api,errorMessage} from '@platform/lib/api';
import {contractClient,unwrapContract} from '@platform/lib/contract-client';

import {useSiteSettings} from '@platform/host/site-settings';
import type {components} from '@platform/lib/generated-api';
export type Session=components['schemas']['SessionView'];
type Turnstile={render:(element:HTMLElement,options:{sitekey:string;callback:(token:string)=>void;'expired-callback':()=>void})=>string;remove:(id:string)=>void;reset:(id:string)=>void};
declare global{interface Window{turnstile?:Turnstile}}
export function useAuthFlow({onLogin}:{onLogin:(session:Session)=>void}){

 const brand=useSiteSettings(state=>state.brand);
 const[mode,setMode]=useState<'login'|'registration'|'recovery'>('login');
 const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[code,setCode]=useState(''),[challenge,setChallenge]=useState(''),[claim,setClaim]=useState(''),[captcha,setCaptcha]=useState(''),[ready,setReady]=useState(false),[pending,setPending]=useState(false),[notice,setNotice]=useState('');
 const[domains,setDomains]=useState<{id:string;domain:string;enabled:boolean;dependenciesReady:boolean}[]>([]),[domain,setDomain]=useState('default'),[policyError,setPolicyError]=useState('');
 const[policy,setPolicy]=useState({enabled:false,siteKey:'',domain:''});const target=useRef<HTMLDivElement>(null);const widget=useRef<string|undefined>(undefined);
 useEffect(()=>{const abort=new AbortController();void api<{items:typeof domains}>('/registration/domains',{signal:abort.signal}).then(r=>{if(!abort.signal.aborted)setDomains(r.items);}).catch(()=>{if(!abort.signal.aborted)setPolicyError('暂时无法获取邮箱域名，请稍后重试');});return()=>abort.abort();},[]);
 useEffect(()=>{const abort=new AbortController();setPolicy({enabled:false,siteKey:'',domain:''});setPolicyError('');void api<typeof policy>('/registration/policy?domainId='+encodeURIComponent(domain),{signal:abort.signal}).then(r=>{if(!abort.signal.aborted)setPolicy(r);}).catch(()=>{if(!abort.signal.aborted)setPolicyError('暂时无法获取注册状态，请稍后重试');});return()=>abort.abort();},[domain]);
 useEffect(()=>{if(mode==='login'||challenge||!ready||!policy.siteKey||!target.current||!window.turnstile)return;const id=window.turnstile.render(target.current,{sitekey:policy.siteKey,callback:setCaptcha,'expired-callback':()=>setCaptcha('')});widget.current=id;return()=>{window.turnstile?.remove(id);widget.current=undefined;};},[mode,ready,policy.siteKey,challenge,policy.enabled]);
 async function run(operation:()=>Promise<void>){setPending(true);setNotice('');try{await operation();}catch(error){setNotice(errorMessage(error));}finally{setPending(false);if(mode!=='login'&&!challenge){setCaptcha('');if(widget.current)window.turnstile?.reset(widget.current);}}}
 async function submit(){
  if(mode==='login')return;
  if(!challenge){const result=unwrapContract(await contractClient.POST('/api/v1/registration/challenges',{body:{email,purpose:mode,turnstile_token:captcha,domainId:mode==='registration'?domain:undefined}}));setChallenge(result.challengeId);setNotice('验证码已发送，10 分钟内有效');return;}
  if(!claim){const result=unwrapContract(await contractClient.POST('/api/v1/registration/verify',{body:{challenge_id:challenge,code}}));setClaim(result.verificationToken);return;}
  const body={challenge_id:challenge,verification_token:claim,password};
  if(mode==='registration')unwrapContract(await contractClient.POST('/api/v1/auth/register',{body:{...body,name}}));else unwrapContract(await contractClient.POST('/api/v1/auth/recovery',{body}));if(mode==='registration')setEmail(name+'@'+policy.domain);setPassword('');setMode('login');setChallenge('');setClaim('');setCode('');setCaptcha('');setNotice('操作成功，请使用邮箱地址和密码登录');
 }
 function changeDomain(next:string){setDomain(next);setChallenge('');setClaim('');setCaptcha('');setCode('');setPassword('');setNotice('');}
 function change(next:typeof mode){setCode('');setMode(next);setChallenge('');setClaim('');setCaptcha('');setPassword('');setNotice('');}
 return {brand,mode,change,email,setEmail,password,setPassword,name,setName,code,setCode,challenge,claim,captcha,ready,setReady,pending,notice,setNotice,domains,domain,changeDomain,policyError,policy,target,run,submit};
}
