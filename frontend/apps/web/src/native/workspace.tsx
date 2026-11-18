'use client';
import {Suspense,useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useAccountStore} from '@/stores/account-store';
import {Action,TextField,PasswordField} from '@mail-web/ui';
import {useNativeSession} from '@/stores/native-host-store';
import {restoreNativeOffline,useAuthStore} from '@/stores/auth-store';
import {api,errorMessage} from '@platform/lib/api';
import {Auth,type Session} from './auth';
import {Button} from '@/components/ui/button';
import {selectedNativeSession} from './session-selection';
import {linkNativeAccount} from './account-link';
function WorkspaceLoading(){return <main className="native-loading" role="status" aria-busy="true"><span className="native-mark" aria-hidden="true">✦</span><p>正在打开邮箱工作区…</p></main>;}
const Mail=dynamic(()=>import('@/components/mail/mail-app').then(m=>m.MailApp),{ssr:false,loading:WorkspaceLoading});
const Calendar=dynamic(()=>import('@/components/calendar/calendar-app').then(m=>m.CalendarApp),{ssr:false});
const Contacts=dynamic(()=>import('@/components/contacts/contacts-app').then(m=>m.ContactsApp),{ssr:false});
const Files=dynamic(()=>import('@/components/files/files-app').then(m=>m.FilesApp),{ssr:false});
const Settings=dynamic(()=>import('@/components/settings/settings-app').then(m=>m.SettingsApp),{ssr:false});
const ComposeWindow=dynamic(()=>import('@/components/popout/popout-compose-app').then(m=>m.PopoutComposeApp),{ssr:false});
const MessageWindow=dynamic(()=>import('@/components/popout/popout-message-app').then(m=>m.PopoutMessageApp),{ssr:false});
let opening:Promise<boolean>|null=null;
function openSession(session:Session){
 useNativeSession.getState().setOperator(session.operator);
 if(useAuthStore.getState().isAuthenticated && useAuthStore.getState().username===session.email)return Promise.resolve(true);
 return opening??=useAuthStore.getState().login(location.origin+'/api/v1/native',session.email,'cookie-session',undefined,false).finally(()=>{opening=null;});
}
type SurfaceName='mail'|'calendar'|'contacts'|'files'|'settings';
export function NativeWorkspace(props:{surface?:SurfaceName}){return <Suspense fallback={<main className="native-loading">正在打开工作区…</main>}><WorkspaceContent {...props}/></Suspense>;}
// A pop-out uses Bulwark's sealed main-window session handoff. A second
// ordinary login gate would initialize every store twice and bypass its
// guest lifecycle. Rust still verifies every request's account cookie.
export function NativeWindowRoute(){return <Suspense fallback={<main className="native-loading">正在打开窗口…</main>}><WindowContent/></Suspense>;}
function WindowContent(){const pathname=usePathname();const id=pathname.split('/').filter(Boolean)[2]??'';return <div className="native-workspace">{pathname.startsWith('/popout/message/')?<MessageWindow id={decodeURIComponent(id)}/>:<ComposeWindow/>}</div>;}
function WorkspaceContent({surface='mail'}:{surface?:SurfaceName}){
 const pathname=usePathname();const router=useRouter();
 const adding=useSearchParams().get("mode")==="add-account";
 const linkSegments=pathname.split('/').filter(Boolean).slice(1);
 const[session,setSession]=useState<Session|null>(null),[pending,setPending]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const ready=useAuthStore(s=>s.isAuthenticated && !!s.client);
 useEffect(()=>{let live=true;void selectedNativeSession(adding).then(async s=>{if(!live)return;setSession(s);localStorage.setItem('mail-web-last-session',JSON.stringify({...s,operator:false}));if(!await openSession(s))throw new Error(useAuthStore.getState().error||'无法连接邮件工作区');}).catch(async e=>{if(!live)return;if(e.status===401&&!adding){const active=useAccountStore.getState().getActiveAccount();if(active)try{await api<Session>('/auth/session',{account:'primary',signal:AbortSignal.timeout(2500)});if(live)router.replace('/login/?mode=add-account&username='+encodeURIComponent(active.username));return;}catch{/* The primary session also needs a normal sign-in. */}}if(e.status!==401 && await restoreNativeOffline()){const saved=localStorage.getItem('mail-web-last-session');if(saved)setSession(JSON.parse(saved));return;}if(live)setError(e.status===401?'':e instanceof Error?e.message:errorMessage(e));}).finally(()=>{if(live)setPending(false);});return()=>{live=false;};},[attempt,adding,router]);
 async function signedIn(s:Session){setSession(s);setPending(true);setError('');try{if(!await openSession(s))throw new Error(useAuthStore.getState().error||'无法连接邮件工作区');}catch(e){setError(e instanceof Error?e.message:'连接失败');}finally{setPending(false);}}
 if(pending)return <WorkspaceLoading/>;
 if(adding&&session)return <AddAccount onDone={()=>{router.replace("/");}}/>;
 if(error || (session && !ready))return <main className="native-loading" role="alert"><h1>邮件工作区暂时无法连接</h1><p>{error}</p><Button onClick={()=>{setPending(true);setError('');setAttempt(n=>n+1);}}>重新连接</Button></main>;
 if(!session)return <Auth onLogin={signedIn}/>;
 const Surface={mail:Mail,calendar:Calendar,contacts:Contacts,files:Files,settings:Settings}[surface];
 return <div className="native-workspace"><Surface linkSegments={linkSegments}/></div>;
}

function AddAccount({onDone}:{onDone:()=>void}){const[email,setEmail]=useState(useSearchParams().get('username')??''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');return <main className="auth-shell"><form className="auth-card" onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void linkNativeAccount(email,password).then(onDone).catch(e=>setError(e instanceof Error&& !('status' in e)?e.message:errorMessage(e))).finally(()=>setBusy(false));}}><p className="console-eyebrow">MULTIPLE ACCOUNTS</p><h1 style={{fontSize:24,marginBlock:20}}>添加邮箱账号</h1><p className="muted">使用已在本站登记的邮箱。服务归属与访问权限由后端核对。</p><div className="console-form-grid" style={{gridTemplateColumns:'1fr'}}><TextField label="邮箱地址" type="email" value={email} onChange={e=>setEmail(e.target.value)}/><PasswordField label="邮箱密码" purpose="current" value={password} onChange={e=>setPassword(e.target.value)}/></div>{error&&<p role="alert">{error}</p>}<div className="console-actions"><Action variant="quiet" disabled={busy} onPress={onDone}>返回邮箱</Action><Action type="submit" loading={busy}>验证并添加</Action></div></form></main>;}
