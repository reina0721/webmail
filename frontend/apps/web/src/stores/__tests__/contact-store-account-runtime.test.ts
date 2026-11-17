import {beforeEach,describe,expect,it,vi} from 'vitest';
import {useContactStore,TRUSTED_SENDERS_BOOK_NAME} from '../contact-store';
import {useSettingsStore} from '../settings-store';
import type {IJMAPClient} from '@/lib/jmap/client-interface';
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
const client=(book:string)=>({supportsContacts:()=>true,getAddressBooks:vi.fn(async()=>[{id:book,name:TRUSTED_SENDERS_BOOK_NAME}]),getContacts:vi.fn(async()=>[]),createContact:vi.fn(async()=>({id:'new'})),getEmails:vi.fn(async()=>({emails:[]}))}) as unknown as IJMAPClient;
beforeEach(()=>{useContactStore.getState().clearContacts();useSettingsStore.setState({trustedSendersAddressBook:true,trustedSenders:[]});});
describe('contact runtime belongs to the active login',()=>{
 it('loads the new login book rather than using the previous login id or recipient cache',async()=>{
  const a=client('book-a'),b=client('book-b');
  await useContactStore.getState().loadTrustedSendersBook(a);
  useContactStore.setState({recentRecipients:[{name:'Private A',email:'a@example.com'}],recentRecipientsLoaded:true,sentMailboxId:'sent-a'});
  useContactStore.getState().clearContacts();
  expect(useContactStore.getState().recentRecipients).toEqual([]);
  expect(useContactStore.getState().sentMailboxId).toBeNull();
  await useContactStore.getState().addToTrustedSendersBook(b,'new@example.com');
  expect(b.createContact).toHaveBeenCalledWith(expect.objectContaining({addressBookIds:{'book-b':true}}));
  expect(a.createContact).not.toHaveBeenCalled();
 });
 it('does not join an outgoing login load or accept its delayed result',async()=>{
  const pending=deferred<never[]>(),a=client('book-a'),b=client('book-b');
  vi.mocked(a.getAddressBooks).mockReturnValue(pending.promise);
  const old=useContactStore.getState().loadTrustedSendersBook(a);
  useContactStore.getState().clearContacts();
  await useContactStore.getState().loadTrustedSendersBook(b);
  pending.resolve([{id:'book-a',name:TRUSTED_SENDERS_BOOK_NAME}] as never[]);await old;
  expect(a.getContacts).not.toHaveBeenCalled();
  expect(useContactStore.getState().trustedSendersBookId).toBe('book-b');
  expect(useContactStore.getState().trustedSendersLoaded).toBe(true);
 });
 it('drops a slow Sent-folder recipient fetch after switching login',async()=>{
  const pending=deferred<{emails:never[]}>(),a=client('book-a'),b=client('book-b');
  vi.mocked(a.getEmails).mockReturnValue(pending.promise as never);
  const old=useContactStore.getState().loadRecentRecipients(a,'sent-a');
  useContactStore.getState().clearContacts();
  await useContactStore.getState().loadRecentRecipients(b,'sent-b');
  pending.resolve({emails:[{to:[{email:'private-a@example.com'}]}] as never[]});await old;
  expect(useContactStore.getState().recentRecipients).toEqual([]);
  expect(useContactStore.getState().sentMailboxId).toBe('sent-b');
 });
});
