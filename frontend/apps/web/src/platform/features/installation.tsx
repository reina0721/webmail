'use client';
import {usePathname,useRouter} from 'next/navigation';
import {useEffect,useState,type ReactNode} from 'react';
import {Action} from '@mail-web/ui/action';
import {api,errorMessage} from '../lib/api';
import type {components} from '../lib/generated-api';

type Status=components['schemas']['InstallationStatus'];
export function InstallationGate({children,onSite}:{children:ReactNode;onSite:(site:{brand:string;domain:string})=>void}){
 const pathname=usePathname();const router=useRouter();
 const[status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setError('');void api<Status>('/installation',{signal:AbortSignal.timeout(2500)}).then(value=>{if(active){setStatus(value);localStorage.setItem('mail-web-site-status',JSON.stringify(value));const brand=value.brand||'Mail Web';onSite({brand,domain:value.domain});}}).catch(e=>{if(!active)return;try{const cached=JSON.parse(localStorage.getItem('mail-web-site-status')||'null');if(cached?.configured&&!cached.needsOperator){setStatus(cached);onSite({brand:cached.brand||'Mail Web',domain:cached.domain});return;}}catch{}setError(errorMessage(e));});return()=>{active=false;};},[revision,onSite]);
 if(error)return <main className="installation-shell" role="alert"><h1>无法读取站点配置</h1><p>{error}</p><Action onPress={()=>setRevision(n=>n+1)}>重新连接</Action></main>;
 if(!status)return <main className="installation-shell" role="status">正在读取站点配置…</main>;
 if(!status.configured||status.needsOperator)return pathname.startsWith('/console')?children:<SetupRedirect/>;
 return children;
}

function SetupRedirect(){const router=useRouter();useEffect(()=>{router.replace("/console/setup/");},[router]);return <main className="native-loading">正在进入自动安装…</main>;}
