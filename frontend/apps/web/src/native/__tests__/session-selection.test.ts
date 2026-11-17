import {beforeEach,expect,it,vi} from 'vitest';
const context=vi.hoisted(()=>({listeners:new Set<(state:any,previous:any)=>void>(),request:vi.fn()}));
vi.mock('@/stores/auth-store',()=>({useAuthStore:{subscribe:(listener:(state:any,previous:any)=>void)=>{context.listeners.add(listener);return()=>context.listeners.delete(listener);}}}));
vi.mock('@platform/lib/api',async original=>({...await original<object>(),api:context.request}));
import {ApiError} from '@platform/lib/api';
import {useAccountStore} from '@/stores/account-store';
import {NATIVE_TAB_ACCOUNT,rememberNativeSelection,selectedNativeSession} from '../session-selection';
const server='http://localhost/api/v1/native';
function add(username:string){return useAccountStore.getState().addAccount({username,serverUrl:server,label:username,email:username,displayName:username,authMode:'basic',rememberMe:false,lastLoginAt:1,isConnected:false,hasError:false,isDefault:false});}
let first:string,second:string;
beforeEach(()=>{
 context.listeners.clear();sessionStorage.clear();useAccountStore.setState({accounts:[],activeAccountId:null,defaultAccountId:null});
 first=add('first@example.com');second=add('second@example.com');
 useAccountStore.getState().setActiveAccount(first);
 context.request.mockReset().mockImplementation(async(_path:string,options:any)=>({email:new Headers(options.headers).get('X-Mail-Account')??'first@example.com',operator:false}));
});
it('restores this tab even after another tab persisted its own active registry account',async()=>{
 sessionStorage.setItem(NATIVE_TAB_ACCOUNT,second);
 expect((await selectedNativeSession()).email).toBe('second@example.com');
 expect(useAccountStore.getState().activeAccountId).toBe(second);
 expect(new Headers(context.request.mock.calls[0][1].headers).get('X-Mail-Account')).toBe('second@example.com');
});
it('does not silently fall back to the primary mailbox when the chosen session expired',async()=>{
 sessionStorage.setItem(NATIVE_TAB_ACCOUNT,second);context.request.mockRejectedValue(new ApiError(401,'session_expired'));
 await expect(selectedNativeSession()).rejects.toMatchObject({status:401});
 expect(context.request).toHaveBeenCalledTimes(1);expect(useAccountStore.getState().activeAccountId).toBe(second);
});
it('keeps a valid selected mailbox while the add-account form is open',async()=>{
 sessionStorage.setItem(NATIVE_TAB_ACCOUNT,second);
 expect((await selectedNativeSession(true)).email).toBe('second@example.com');
 expect(context.request).toHaveBeenCalledTimes(1);
 expect(new Headers(context.request.mock.calls[0][1].headers).get('X-Mail-Account')).toBe('second@example.com');
});
it('lets the add-account form use primary authorization only after the selected mailbox expired',async()=>{
 sessionStorage.setItem(NATIVE_TAB_ACCOUNT,second);context.request.mockRejectedValueOnce(new ApiError(401,'session_expired'));
 expect((await selectedNativeSession(true)).email).toBe('first@example.com');
 expect(context.request.mock.calls[1][1]).toMatchObject({account:'primary'});
});
it('ignores a removed tab selection instead of resurrecting a signed-out account',async()=>{
 sessionStorage.setItem(NATIVE_TAB_ACCOUNT,second);useAccountStore.getState().removeAccount(second);
 expect((await selectedNativeSession()).email).toBe('first@example.com');
});
it('records real account switches but not passive connection updates from an older document',()=>{
 sessionStorage.setItem(NATIVE_TAB_ACCOUNT,second);const stop=rememberNativeSelection();
 const a={activeAccountId:first,isAuthenticated:true,serverUrl:server};
 for(const listener of context.listeners)listener({...a,connectionLost:false},a);
 expect(sessionStorage.getItem(NATIVE_TAB_ACCOUNT)).toBe(second);
 for(const listener of context.listeners)listener({...a,activeAccountId:second},a);
 expect(sessionStorage.getItem(NATIVE_TAB_ACCOUNT)).toBe(second);
 for(const listener of context.listeners)listener({...a,activeAccountId:null,isAuthenticated:false},{...a,activeAccountId:second});
 expect(sessionStorage.getItem(NATIVE_TAB_ACCOUNT)).toBeNull();stop();expect(context.listeners.size).toBe(0);
});
