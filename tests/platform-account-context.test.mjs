import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api,configureAccountContext} from '../frontend/apps/web/src/platform/lib/api.ts';
test('platform operations use the selected verified account and its CSRF cookie; primary login stays explicit',async()=>{
 const previousFetch=globalThis.fetch,previousDocument=globalThis.document,previousLocation=globalThis.location;
 const email='operator@example.com',slot=Buffer.from(email).toString('hex'),seen=[];
 try{
  globalThis.document={cookie:'mail_csrf=primary; mail_csrf_'+slot+'=selected'};globalThis.location={protocol:'http:'};configureAccountContext(()=>email);
  globalThis.fetch=async(url,init)=>{seen.push({url,headers:new Headers(init.headers)});return new Response(null,{status:204});};
  await api('/admin/client-policy',{method:'PUT',body:'{}'});
  assert.equal(seen[0].headers.get('X-Mail-Account'),email);assert.equal(seen[0].headers.get('X-CSRF-Token'),'selected');
  await api('/auth/session',{account:'primary'});assert.equal(seen[1].headers.has('X-Mail-Account'),false);
 }finally{configureAccountContext(()=>undefined);globalThis.fetch=previousFetch;globalThis.document=previousDocument;globalThis.location=previousLocation;}
});
