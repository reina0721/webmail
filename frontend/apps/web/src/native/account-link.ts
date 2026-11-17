import {api} from '@platform/lib/api';
import {useAuthStore} from '@/stores/auth-store';

export async function linkNativeAccount(email:string,password:string){
 // Verify first: a rejected additional login must never clear the mailbox
 // already open in this window. Rust retains the primary cookie separately.
 await api('/auth/login',{account:'active',method:'POST',headers:{'X-Mail-Link':'1'},body:JSON.stringify({email,password})});
 const connected=await useAuthStore.getState().login(location.origin+'/api/v1/native',email,'cookie-session',undefined,false);
 if(!connected){
  const reason=useAuthStore.getState().error;
  throw new Error(reason==='invalid_credentials'?'此账号登录已过期，请重新验证。':'账号验证已完成，但暂时无法连接邮件服务。当前邮箱已保留，请稍后重试。');
 }
}
