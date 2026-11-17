import {beforeEach,expect,it,vi} from 'vitest';
const auth=vi.hoisted(()=>({serverUrl:'',signIn:vi.fn()}));
vi.mock('@/stores/auth-store',()=>({useAuthStore:{getState:()=>({serverUrl:auth.serverUrl,signInRestoredAccount:auth.signIn,getClientForAccount:()=>undefined})}}));
import {restoreArchive,restoreAccounts} from '@/lib/account-archive-client';
import {useAccountStore} from '@/stores/account-store';
import {JMAPClient} from '@/lib/jmap/client';
beforeEach(()=>{auth.serverUrl=location.origin+'/api/v1/native';auth.signIn.mockReset();useAccountStore.setState({accounts:[],activeAccountId:null,defaultAccountId:null});});
it('a native cookie client never exports the placeholder as a mailbox password',()=>{
 const client=new JMAPClient(auth.serverUrl,'sakura@example.com','cookie-session');expect(client.getBasicPassword()).toBeNull();
});
it('restores only locally registered-server candidates and keeps them awaiting verification',()=>{
 const result=restoreAccounts([{username:'sakura@example.com',serverUrl:auth.serverUrl,label:'Sakura',avatarColor:'#cc6688'},{username:'foreign@example.net',serverUrl:'https://foreign.example.net/api/v1/native',label:'Foreign',avatarColor:'#cc6688'}]);
 expect(result).toEqual({added:1,updated:0,skipped:1});expect(useAccountStore.getState().accounts[0].awaitingSignIn).toBe(true);
});
it('does not replay archived passwords to an external server even if its registry entry already exists',async()=>{
 const foreign={username:'foreign@example.net',serverUrl:'https://foreign.example.net',label:'Foreign',avatarColor:'#cc6688',password:'never-transmit'};
 useAccountStore.getState().addAccount({...foreign,authMode:'basic',rememberMe:false,displayName:foreign.label,email:foreign.username,lastLoginAt:0,isConnected:false,hasError:true,isDefault:false});
 await restoreArchive([foreign],false);expect(auth.signIn).not.toHaveBeenCalled();
});
