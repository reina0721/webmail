import {useAccountStore} from '@/stores/account-store';
import {useAuthStore} from '@/stores/auth-store';
import {isNativeServer} from '@/lib/platform-transport';
import {api} from '@platform/lib/api';
import type {Session} from './auth-controller';

export const NATIVE_TAB_ACCOUNT = 'mail-web-tab-account';

// The registry is shared by browser tabs. A background connection update in
// an older tab also persists its registry, including that tab's active id.
// Keep this window's selection separately; it contains no authentication data.
export function rememberNativeSelection() {
 return useAuthStore.subscribe((state,previous)=>{
  if(state.activeAccountId===previous.activeAccountId)return;
  try {
   if(state.isAuthenticated && isNativeServer(state.serverUrl) && state.activeAccountId)
    sessionStorage.setItem(NATIVE_TAB_ACCOUNT,state.activeAccountId);
   else sessionStorage.removeItem(NATIVE_TAB_ACCOUNT);
  } catch { /* Storage can be disabled; the verified registry remains usable. */ }
 });
}

export async function selectedNativeSession(allowPrimaryFallback=false):Promise<Session>{
 const state=useAccountStore.getState();
 let tabId:string|null=null;
 try{tabId=sessionStorage.getItem(NATIVE_TAB_ACCOUNT);}catch{/* No tab storage. */}
 const saved=state.getAccountById(tabId??'');
 const active=saved && isNativeServer(saved.serverUrl)?saved:state.getAccountById(state.activeAccountId??'');
 if(active && isNativeServer(active.serverUrl)){
  // An expired chosen mailbox is not permission to display another mailbox.
  state.setActiveAccount(active.id);
  try{return await api<Session>('/auth/session',{headers:{'X-Mail-Account':active.username},signal:AbortSignal.timeout(2500)});}
  catch(error){if(!allowPrimaryFallback||!(error instanceof Error)||!('status' in error)||error.status!==401)throw error;}
 }
 return api<Session>('/auth/session',{account:'primary',signal:AbortSignal.timeout(2500)});
}
