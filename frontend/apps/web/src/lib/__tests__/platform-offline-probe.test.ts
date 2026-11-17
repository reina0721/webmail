import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {configureNativeAccountContext,nativeOfflineServerKey,nativeOfflineTarget,nativeServerUnavailable} from '../platform-transport';
import {isOfflineNow,setServerDown,useOfflineStore} from '../offline/state';
const server='http://mailweb.localhost:19196/api/v1/native';
beforeEach(()=>{configureNativeAccountContext(()=>undefined);useOfflineStore.setState({browserOffline:false,downServers:[]});});
afterEach(()=>{vi.unstubAllGlobals();configureNativeAccountContext(()=>undefined);});
describe('official services behind the native proxy remain independent offline',()=>{
 it('distinguishes mail-service outages from authentication refusals and throttling',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  for(const status of [200,401,403,429,502,503,504]){
   fetch.mockResolvedValueOnce(new Response(null,{status}));
   expect(await nativeServerUnavailable(server,'a@example.com')).toBe([502,503,504].includes(status));
   const headers=fetch.mock.calls.at(-1)![1].headers as Headers;
   expect(headers.get('X-Mail-Account')).toBe('a@example.com');
  }
  fetch.mockRejectedValueOnce(new TypeError('connection refused'));
  expect(await nativeServerUnavailable(server,'a@example.com')).toBe(true);
 });
 it('keeps outages and recovery scoped even though both accounts use the same proxy',()=>{
  setServerDown(server,true,'a@example.com');
  expect(isOfflineNow(server,'a@example.com')).toBe(true);
  expect(isOfflineNow(server,'b@example.com')).toBe(false);
  configureNativeAccountContext(()=>'b@example.com');
  expect(isOfflineNow(server)).toBe(false);
  const a=nativeOfflineServerKey(server,'a@example.com');
  expect(nativeOfflineTarget(a)).toEqual({server,account:'a@example.com'});
  setServerDown(a,false);
  expect(isOfflineNow(server,'a@example.com')).toBe(false);
 });
 it('does not change direct upstream probes or their keys',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect(await nativeServerUnavailable('https://mail.example.org','a@example.com')).toBeNull();
  expect(nativeOfflineServerKey('https://mail.example.org')).toBe('https://mail.example.org');
  expect(fetch).not.toHaveBeenCalled();
 });
});
