'use client';
import {useEffect,useRef,useState} from 'react';
import {ConfirmDialog} from '@mail-web/ui/overlays';
import {Action} from '@mail-web/ui/action';
import {TextField,PasswordField,SelectField,CheckboxField} from '@mail-web/ui/form-field';
import {api,errorMessage,ApiError} from '@platform/lib/api';
import {operationId} from '@platform/host/operation-id';
import {normalizeStalwart} from '@platform/host/stalwart-origin';
type Service={id:string;name:string;origin:string;configured:boolean};
type Domain={id:string;serviceId:string;name:string;upstreamId:string};
type Job={status:string;step:string;error:string;spec:{domain:string;createDomain:boolean};resources:Record<string,string>};
export function useConnections({token,origin,brand,onDirtyChange,initialServiceId}:{token:string;origin:string;brand:string;onDirtyChange:(dirty:boolean)=>void;initialServiceId?:string}){
 const[services,setServices]=useState<Service[]>([]),[bindings,setBindings]=useState<Domain[]>([]),[selected,setSelected]=useState(initialServiceId??'default'),[fresh,setFresh]=useState(false),[prepared,setPrepared]=useState(false),[name,setName]=useState(''),[base,setBase]=useState('');
 const[advanced,setAdvanced]=useState(false),[advancedDirty,setAdvancedDirty]=useState(false),[leave,setLeave]=useState<(()=>void)|null>(null);
 function guard(work:()=>void){if(dirty||advancedDirty)setLeave(()=>work);else work();}
 const[mode,setMode]=useState('password'),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[key,setKey]=useState(''),[ticket,setTicket]=useState(''),[available,setAvailable]=useState<{id:string;name:string}[]>([]),[domain,setDomain]=useState(''),[createDomain,setCreateDomain]=useState(false),[missing,setMissing]=useState<string[]>([]),[preview,setPreview]=useState<string[]|null>(null),[job,setJob]=useState<Job|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const epoch=useRef(0);const current=services.find(s=>s.id===selected);const running=job?.status==='running'||job?.status==='applying';
 const dirty=!!password||!!key||!!ticket||(fresh&&!prepared&&!!(name||base));
 useEffect(()=>{onDirtyChange(dirty||advancedDirty);return()=>onDirtyChange(false);},[dirty,advancedDirty,onDirtyChange]);
 const headers=()=>token?{Authorization:'Bearer '+token}:undefined;
 const scoped=(path:string,id=selected)=>path+'?serviceId='+encodeURIComponent(id);
 async function refresh(){const r=await api<{services:Service[];domains:Domain[]}>('/installation/connections',{headers:headers()});setServices(r.services);setBindings(r.domains);return r;}
 useEffect(()=>{let live=true;void refresh().then(r=>{if(!live)return;const requested=new URLSearchParams(location.search).get('connection');if(requested&&r.services.some(s=>s.id===requested))setSelected(requested);}).catch(e=>{if(live)setError(errorMessage(e));});return()=>{live=false;epoch.current++;};},[token]);
 useEffect(()=>{if(fresh||selected==='default')return;const abort=new AbortController();async function poll(){try{const r=await api<{job:Job|null}>(scoped('/installation/initialize/job'),{headers:headers(),signal:abort.signal});if(abort.signal.aborted)return;setJob(r.job);if(!r.job)clearInterval(interval);if(r.job){setDomain(r.job.spec.domain);setCreateDomain(r.job.spec.createDomain);if(r.job.status==='completed')await refresh();if(r.job.status!=='running'&&r.job.status!=='applying')clearInterval(interval);}}catch(e){if(!abort.signal.aborted)setError(errorMessage(e));}}void poll();const interval=setInterval(()=>void poll(),3000);return()=>{abort.abort();clearInterval(interval);};},[selected,fresh,token,job?.status]);
 function clear(){epoch.current++;setAdvanced(false);setPassword('');setKey('');setUsername('');setTicket('');setPreview(null);setJob(null);setAvailable([]);setMissing([]);setDomain('');setCreateDomain(false);setError('');}
 function choose(id:string){clear();setSelected(id);setFresh(false);setPrepared(true);const url=new URL(location.href);url.searchParams.set('connection',id);history.replaceState(history.state,'',url);}
 async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 const spec=()=>({brand,domain,publicOrigin:origin,createDomain,directoryQueries:true,operatorMode:'existing',operatorEmail:'',recoveryEmail:'',cloudflareAccount:''});
 async function authorize(){const id=selected;let source=current?.origin??normalizeStalwart(base);if(!source)throw Error('invalid origin');if(fresh&&!prepared){await api('/installation/connections/prepare',{method:'POST',headers:headers(),body:JSON.stringify({id,name,origin:source})});setPrepared(true);const url=new URL(location.href);url.searchParams.set('connection',id);history.replaceState(history.state,'',url);await refresh();}
 const result=await api<{ticket:string;domains:{id:string;name:string}[];missingPermissions:string[]}>(scoped('/installation/initialize/authorize',id),{method:'POST',headers:headers(),body:JSON.stringify({base:source,username:mode==='password'?username:'',password:mode==='password'?password:'',apiKey:mode==='key'?key:''})});setPassword('');setKey('');setTicket(result.ticket);setAvailable(result.domains);setMissing(result.missingPermissions);if(!domain&&result.domains.length===1)setDomain(result.domains[0]!.name);}
 async function inspect(){const result=await api<{resources:string[]}>(scoped('/installation/initialize/preflight'),{method:'POST',headers:headers(),body:JSON.stringify({ticket,spec:spec()})});setPreview(result.resources);}
 async function start(){const result=await api<{job:Job}>(scoped('/installation/initialize/job'),{method:'POST',headers:headers(),body:JSON.stringify({ticket,spec:spec()})});setJob(result.job);setTicket('');setFresh(false);await refresh();}
 async function readDomains(){const result=await api<{domains:{id:string;name:string}[]}>(scoped('/installation/discover'),{method:'POST',headers:headers(),body:JSON.stringify({stalwartUrl:current!.origin,publicOrigin:origin,domain:'',provisioningKey:''})});setAvailable(result.domains);}
 async function addDomain(){const all=bindings.filter(d=>d.serviceId===selected).map(d=>d.name);await api('/installation/connections',{method:'POST',headers:headers(),body:JSON.stringify({id:selected,name:current!.name,origin:current!.origin,settings:{},domains:[...all,domain]})});await refresh();setDomain('');setAvailable([]);}
 return {services,bindings,selected,setSelected,fresh,setFresh,prepared,setPrepared,name,setName,base,setBase,advanced,setAdvanced,leave,setLeave,guard,mode,setMode,username,setUsername,password,setPassword,key,setKey,ticket,setTicket,available,domain,setDomain,createDomain,setCreateDomain,missing,preview,setPreview,job,busy,error,current,running,dirty,refresh,clear,choose,run,authorize,inspect,start,readDomains,addDomain};
}
