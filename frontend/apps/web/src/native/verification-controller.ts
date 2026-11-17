'use client';
import {useEffect,useRef,useState} from 'react';
import Script from 'next/script';
import {Action} from '@mail-web/ui/action';
import {TextField} from '@mail-web/ui/form-field';
import {api,errorMessage} from '@platform/lib/api';
import type {} from './auth-controller';
export function useVerification(){
 const[ticket,setTicket]=useState(''),[siteKey,setSiteKey]=useState(''),[ready,setReady]=useState(false),[captcha,setCaptcha]=useState(''),[email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[done,setDone]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');const target=useRef<HTMLDivElement>(null),widget=useRef<string|undefined>(undefined);
 useEffect(()=>{const fragment=new URLSearchParams(location.hash.slice(1)),value=fragment.get('check')??history.state?.registrationCheck??'';history.replaceState({...history.state,registrationCheck:value},'',location.pathname);setTicket(value);void api<{siteKey:string;mailSent:boolean}>('/readiness/session',{method:'POST',body:JSON.stringify({ticket:value})}).then(r=>{setSiteKey(r.siteKey);setSent(r.mailSent);}).catch(e=>setError(errorMessage(e)));},[]);
 useEffect(()=>{if(!ready||!siteKey||!target.current||!window.turnstile||sent)return;const id=window.turnstile.render(target.current,{sitekey:siteKey,callback:setCaptcha,'expired-callback':()=>setCaptcha('')});widget.current=id;return()=>{window.turnstile?.remove(id);widget.current=undefined;};},[ready,siteKey,sent]);
 async function submit(){setPending(true);setError('');try{await api(sent?'/readiness/verify':'/readiness/send',{method:'POST',body:JSON.stringify({ticket,email,code,turnstile_token:captcha})});if(sent){setDone(true);setTicket('');setCaptcha('');setCode('');history.replaceState({...history.state,registrationCheck:null},'',location.pathname);}else setSent(true);}catch(e){setError(errorMessage(e));if(!sent){setCaptcha('');if(widget.current)window.turnstile?.reset(widget.current);}}finally{setPending(false);}}
 return {ticket,siteKey,ready,setReady,captcha,email,setEmail,code,setCode,sent,done,pending,error,target,submit};
}
