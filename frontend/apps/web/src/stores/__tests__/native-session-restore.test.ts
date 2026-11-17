import {beforeEach,expect,it,vi} from 'vitest';
import {createConfig} from '@/lib/__tests__/fixtures/config';
const faults=vi.hoisted(()=>new Map<string,string>());
const connections=vi.hoisted(()=>new Map<string,number>());
vi.mock('@/lib/jmap/client',()=>{
 class JMAPClient {
  constructor(public serverUrl:string,public username:string,public password:string){}
  async connect(){connections.set(this.username,(connections.get(this.username)??0)+1);const fault=faults.get(this.username);if(fault)throw new Error(fault);}
  getSessionUsername(){return this.username;} getUsername(){return this.username;}
  async getIdentities(){return [{id:'identity',email:this.username,name:this.username,mayDelete:false}];}
  getAccountId(){return this.username;} getAuthHeader(){return '';} getServerUrl(){return this.serverUrl;}
  onConnectionChange(){} onRateLimit(){} disconnect(){} getRateLimitRemainingMs(){return 0;}
  supportsContacts(){return false;} supportsPrincipals(){return false;} supportsCalendars(){return false;}
  supportsSieve(){return false;} supportsVacationResponse(){return false;}
 }
 return {JMAPClient,RateLimitError:class extends Error{}};
});
vi.mock('@/lib/stalwart/principal',()=>({fetchPrincipalDisplayName:async()=>null}));
import {useAccountStore} from '@/stores/account-store';
import {generateAccountId} from '@/lib/account-utils';
import {useAuthStore} from '@/stores/auth-store';
import * as navigation from '@/lib/browser-navigation';
const server='http://localhost/api/v1/native';
const account=(name:string,slot:number)=>({id:generateAccountId(name,server),serverUrl:server,username:name,label:name,authMode:'basic' as const,rememberMe:false,cookieSlot:slot,displayName:name,email:name,isConnected:false,hasError:false,lastLoginAt:1,avatarColor:'#000',isDefault:slot===0});
const calls:Array<{url:string,method?:string,account:string|null}>=[];
beforeEach(()=>{
 faults.clear();connections.clear();calls.length=0;
 vi.spyOn(navigation,'replaceWindowLocation').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn(async(input:unknown,init?:RequestInit)=>{
  const url=String(input);calls.push({url,method:init?.method,account:new Headers(init?.headers).get('X-Mail-Account')});
  if(url.includes('/api/config'))return Response.json(createConfig({settingsSyncEnabled:false}));
  return Response.json({settings:null});
 }));
});
it('restores a native cookie client on demand without the upstream remembered-password endpoint',async()=>{
 const a=account('restore@example.com',0);useAccountStore.setState({accounts:[a],activeAccountId:null});
 useAuthStore.setState({serverUrl:server,isAuthenticated:false,activeAccountId:null,client:null});
 await useAuthStore.getState().switchAccount(a.id);
 expect(useAuthStore.getState().username).toBe(a.username);
 expect(useAuthStore.getState().client).not.toBeNull();
 expect(calls.some(c=>c.url.startsWith('/api/auth/session'))).toBe(false);
});
it('keeps the current mailbox and the expired account registry while asking for reauthentication',async()=>{
 const a=account('restore@example.com',0),b=account('expired@example.com',1);
 useAccountStore.setState({accounts:[a,b],activeAccountId:a.id});faults.set(b.username,'Invalid username or password');
 const current=useAuthStore.getState().client;await useAuthStore.getState().switchAccount(b.id);
 expect(useAuthStore.getState().client).toBe(current);
 expect(useAccountStore.getState().getAccountById(b.id)?.awaitingSignIn).toBe(true);
 expect(navigation.replaceWindowLocation).toHaveBeenCalledWith('/login?mode=add-account&username=expired%40example.com');
 expect(calls.some(c=>c.method==='DELETE')).toBe(false);
});
it('revokes every native server session before clearing all local accounts',async()=>{
 const a=account('restore@example.com',0),b=account('second@example.com',1);
 useAccountStore.setState({accounts:[a,b],activeAccountId:a.id});
 await useAuthStore.getState().logoutAll();
 const revoked=calls.filter(c=>c.url==='/api/v1/auth/logout'&&c.method==='POST').map(c=>c.account).sort();
 expect(revoked).toEqual([a.username,b.username].sort());
 expect(useAccountStore.getState().accounts).toHaveLength(0);
 expect(calls.some(c=>c.url.startsWith('/api/auth/session'))).toBe(false);
});
it('replaces the active local-only client when its native cookie connection recovers',async()=>{
 const a=account('offline-recovery@example.com',0);
 const localOnly={isOfflineOnly:()=>true};
 useAccountStore.setState({accounts:[a],activeAccountId:a.id});
 useAuthStore.setState({serverUrl:server,username:a.username,isAuthenticated:true,activeAccountId:a.id,client:localOnly as never,connectionLost:true});
 await useAuthStore.getState().checkAuth();
 expect(useAuthStore.getState().client).not.toBe(localOnly);
 expect(useAuthStore.getState().client?.getUsername()).toBe(a.username);
 expect(useAuthStore.getState().getClientForAccount(a.id)).toBe(useAuthStore.getState().client);
 expect(useAuthStore.getState().connectionLost).toBe(false);
 expect(useAccountStore.getState().getAccountById(a.id)?.isConnected).toBe(true);
});
it('shares native restoration between module hosts and connects additional mailboxes outside the mail surface',async()=>{
 const a=account('module-owner@example.com',0),b=account('module-linked@example.com',1);
 useAccountStore.setState({accounts:[a,b],activeAccountId:a.id});
 useAuthStore.setState({serverUrl:server,username:a.username,isAuthenticated:true,activeAccountId:a.id,client:{} as never});
 await Promise.all([useAuthStore.getState().checkAuth(),useAuthStore.getState().checkAuth()]);
 expect(connections.get(a.username)).toBe(1);expect(connections.get(b.username)).toBe(1);
 expect(useAccountStore.getState().accounts.every(a=>a.isConnected)).toBe(true);
 expect(useAuthStore.getState().getClientForAccount(b.id)?.getUsername()).toBe(b.username);
 expect(useAuthStore.getState().username).toBe(a.username);
});
it('keeps the existing native mailbox when an additional cookie connection is refused',async()=>{
 const a=account('kept-owner@example.com',0),b=account('refused-linked@example.com',1);const liveClient={getUsername:()=>a.username};
 useAccountStore.setState({accounts:[a,b],activeAccountId:a.id});
 useAuthStore.setState({serverUrl:server,username:a.username,isAuthenticated:true,activeAccountId:a.id,client:liveClient as never});
 faults.set(b.username,'Invalid username or password');
 expect(await useAuthStore.getState().login(server,b.username,'cookie-session',undefined,false)).toBe(false);
 expect(useAuthStore.getState()).toMatchObject({isAuthenticated:true,username:a.username,activeAccountId:a.id,client:liveClient,error:'invalid_credentials'});
 expect(useAccountStore.getState().activeAccountId).toBe(a.id);
});
