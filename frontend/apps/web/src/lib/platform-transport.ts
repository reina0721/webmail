import {generateUUID} from '@/lib/uuid';
/** Rust owns authentication and upstream selection. No upstream credential enters this client. */
export const NATIVE_SERVER_SUFFIX = '/api/v1/native';
export function isNativeServer(server: string | null | undefined) { return !!server?.endsWith(NATIVE_SERVER_SUFFIX); }
export function nativeUploadFailure(status:number,body:string):Error|null {
  if(status!==429)return null;
  try{if(JSON.parse(body).code==='upload_quota_exceeded')return new Error('邮件服务的临时上传空间已满，请稍后重试。附件与编辑内容已保留。');}catch{/* Not a native error response. */}
  return null;
}
export function nativeCookieSlot(email:string){return Array.from(new TextEncoder().encode(email)).map(n=>n.toString(16).padStart(2,"0")).join("");}
export function nativeCsrf(email?:string): string {
  if (typeof document === 'undefined') return '';
  const cookies=document.cookie.split(';').map(s=>s.trim());
  const name=(location.protocol==='https:'?'__Host-':'')+'mail_csrf';
  return (email?cookies.find(s=>s.startsWith(name+'_'+nativeCookieSlot(email)+'=')):undefined)?.split('=')[1] ?? cookies.find(s=>s.startsWith(name+'='))?.split('=')[1] ?? '';
}
export function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const local = url.startsWith('/api/v1/') || typeof location !== 'undefined' && url.startsWith(location.origin + '/api/v1/');
  if (!local) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.delete('Authorization');
  if (init?.method && !['GET','HEAD'].includes(init.method.toUpperCase())) {
    headers.set('X-CSRF-Token', nativeCsrf(headers.get('X-Mail-Account')??undefined));
    if (url.includes('/jmap') && !headers.has('Idempotency-Key')) headers.set('Idempotency-Key', generateUUID());
  }
  return fetch(input, {...init, headers, credentials:'same-origin'}).then(async response=>{
    if(response.status===429 && url.includes('/jmap/upload/')){
      const failure=nativeUploadFailure(response.status,await response.clone().text());
      if(failure)throw failure;
    }
    if(response.status===413){
      const error=await response.clone().json().catch(()=>null);
      if(error?.code==='attachment_too_large')throw new Error('这封邮件的附件总量超过本站限额。请移除部分附件，或改用文件共享。');
      if(error?.code==='upload_too_large')throw new Error('文件超过邮件服务器允许的上传大小，请选择较小的文件。');
    }
    if(response.status===403 && url.includes('/jmap') && typeof init?.body==='string') {
      const error=await response.clone().json().catch(()=>null);
      if(error?.code==='jmap_method_forbidden') {
        try {console.warn('[Native JMAP] Unsupported request methods:',JSON.parse(init.body).methodCalls?.map((call:unknown[])=>call[0]));} catch { /* Never log request arguments. */ }
      }
    }
    if(response.status===503){
      const error=await response.clone().json().catch(()=>null);
      if(error?.code==='automatic_gateway_not_configured')throw new Error('此邮件服务尚未完成自动发送网关配置。请在控制台运行自动配置升级后重试；规则内容已保留。');
    }
    if([409,502].includes(response.status)){
      const body=await response.clone().json().catch(()=>null);
      if(body?.code==='submission_record_archived')throw new Error('这次发送已记录并归档，系统不会重复发送。请在发送记录或已发送文件夹中核对。');
      if(body?.code==='submission_check_required')throw new Error('服务器可能已接收这封邮件。请先到账号设置的「发送提交记录」核对，确认前不要重新发送。');
    }
    return response;
  });
}

let nativeAccountContext:()=>string|undefined=()=>undefined;
export function configureNativeAccountContext(read:()=>string|undefined){nativeAccountContext=read;}
/** Logical outage keys are per verified login, although both services share this proxy URL. */
export function nativeOfflineTarget(url:string,username?:string):{server:string;account:string|undefined}|null {
 const [server,fragment]=url.split('#',2);
 if(!isNativeServer(server.replace(/\/+$/,'')))return null;
 let account=username??nativeAccountContext();
 if(fragment?.startsWith('mail-account='))try{account=decodeURIComponent(fragment.slice(13));}catch{return null;}
 return {server:server.replace(/\/+$/,''),account};
}
export function nativeOfflineServerKey(url:string,username?:string):string {
 const target=nativeOfflineTarget(url,username);
 return target?target.server+'#mail-account='+encodeURIComponent(target.account??''):url;
}
/** A reachable Rust proxy can still report an unavailable official mail service. */
export async function nativeServerUnavailable(url:string,username?:string):Promise<boolean|null>{
 const target=nativeOfflineTarget(url,username);if(!target)return null;
 try{
  const response=await nativeFetch('/api/v1/jmap/session',{headers:target.account?{'X-Mail-Account':target.account}:{},cache:'no-store',signal:AbortSignal.timeout(5000)});
  // Authentication refusals and rate limits must not reopen an offline session.
  return [502,503,504].includes(response.status);
 }catch{return true;}
}
