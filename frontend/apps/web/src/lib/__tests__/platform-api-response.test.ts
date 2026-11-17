import {afterEach,expect,it,vi} from 'vitest';
import {api,ApiError,configureAccountContext} from '@platform/lib/api';

afterEach(()=>{vi.unstubAllGlobals();configureAccountContext(()=>undefined);});
it('accepts an empty durable policy update response and keeps the selected account',async()=>{
 configureAccountContext(()=>'sakura@example.com');
 const send=vi.fn().mockResolvedValue(new Response(null,{status:202}));
 vi.stubGlobal('fetch',send);
 await expect(api('/admin/users/example',{method:'PATCH',body:JSON.stringify({hourlyRecipients:99})})).resolves.toBeUndefined();
 const [url,init]=send.mock.calls[0];
 expect(url).toBe('/api/v1/admin/users/example');
 expect(init.headers.get('X-Mail-Account')).toBe('sakura@example.com');
});
it('still decodes JSON responses and rejects an unsuccessful save',async()=>{
 const send=vi.fn().mockResolvedValueOnce(Response.json({items:[]})).mockResolvedValueOnce(Response.json({code:'limits_invalid'},{status:400}));
 vi.stubGlobal('fetch',send);
 await expect(api('/admin/users')).resolves.toEqual({items:[]});
 await expect(api('/admin/users/example',{method:'PATCH'})).rejects.toEqual(new ApiError(400,'limits_invalid'));
});
