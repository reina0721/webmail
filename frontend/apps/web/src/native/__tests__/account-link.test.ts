import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({request:vi.fn(),login:vi.fn(),error:null as string|null}));
vi.mock('@platform/lib/api',async original=>({...await original<object>(),api:f.request}));
vi.mock('@/stores/auth-store',()=>({useAuthStore:{getState:()=>({login:f.login,error:f.error})}}));
import {ApiError} from '@platform/lib/api';
import {linkNativeAccount} from '../account-link';
beforeEach(()=>{f.request.mockReset().mockResolvedValue(undefined);f.login.mockReset().mockResolvedValue(true);f.error=null;});
it('does not touch the active workspace when the added account has invalid credentials',async()=>{
 f.request.mockRejectedValue(new ApiError(401,'credentials_invalid'));
 await expect(linkNativeAccount('new@example.com','test-secret')).rejects.toMatchObject({code:'credentials_invalid'});
 expect(f.login).not.toHaveBeenCalled();
});
it('uses the current verified account to link and only a cookie marker for the JMAP connection',async()=>{
 await linkNativeAccount('new@example.com','test-secret');
 expect(f.request).toHaveBeenCalledWith('/auth/login',expect.objectContaining({account:'active',headers:{'X-Mail-Link':'1'},body:JSON.stringify({email:'new@example.com',password:'test-secret'})}));
 expect(f.login).toHaveBeenCalledWith(location.origin+'/api/v1/native','new@example.com','cookie-session',undefined,false);
});
it('returns an actionable connection error after the account was verified',async()=>{
 f.login.mockResolvedValue(false);f.error='generic';
 await expect(linkNativeAccount('new@example.com','test-secret')).rejects.toThrow('当前邮箱已保留');
});
