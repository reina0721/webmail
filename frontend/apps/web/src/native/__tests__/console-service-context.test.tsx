import {fireEvent, screen, render, waitFor} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
import {useConsoleDomain} from '@/stores/native-host-store';
const request=vi.hoisted(()=>vi.fn());
vi.mock('@platform/lib/api', async original=>({...await original<object>(),api:request}));
vi.mock('../readiness',()=>({RegistrationReadiness:({domainId}:{domainId:string})=><div>Health: {domainId}</div>}));
vi.mock('../directory-policy',()=>({ConsoleDirectory:({domainId,onDirtyChange}:{domainId:string;onDirtyChange:(dirty:boolean)=>void})=><button onClick={()=>onDirtyChange(true)}>Edit directory: {domainId}</button>}));
import {Console} from '../console';
const connections={services:[{id:'default',name:'A',origin:'https://a.example',configured:true},{id:'second',name:'B',origin:'https://b.example',configured:true}],domains:[{id:'default',name:'a.example',serviceId:'default',serviceName:'A'},{id:'domain-b',name:'b.example',serviceId:'second',serviceName:'B'}]};
beforeEach(()=>{
 useConsoleDomain.setState({domain:'default'});history.replaceState({},'','/console/services/');
 request.mockReset().mockImplementation(async(path:string)=>{
  if(path==='/auth/session')return {id:'operator',email:'operator@a.example',operator:true};
  if(path==='/installation/connections')return connections;
  if(path.startsWith('/admin/users'))return {items:[]};
  if(path.startsWith('/admin/registration'))return {policy:{enabled:true,maximumAccounts:100,quotaBytes:1048576,attachmentBytes:1048576,hourlyRecipients:100,dailyRecipients:500}};
  if(path.startsWith('/admin/tasks'))return {};
  if(path.startsWith('/admin/audit'))return {items:[]};
  if(path==='/installation/config')return {settings:{brand:'Mail',publicOrigin:'http://localhost:3000'}};
  if(path==='/health/ready')return {version:'1',revision:'test'};
  if(path.startsWith('/installation/initialize/job'))return {job:null};
  throw new Error('Unexpected request: '+path);
 });
});
async function select(label:string,option:string){fireEvent.mouseDown(await screen.findByRole('combobox',{name:label}));fireEvent.click(await screen.findByRole('option',{name:option}));}
async function expectContext(domain:string,service:string){
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'管理域名'})).toHaveTextContent(domain));
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'邮件服务'})).toHaveTextContent(service));
}
it('keeps header domain, service form and directory scope together, including a stale connection URL',async()=>{
 render(<Console section="services"/>);await expectContext('a.example · A','A · 已连接');
 await select('管理域名','b.example · B');await expectContext('b.example · B','B · 已连接');
 expect(screen.getByRole('button',{name:'Edit directory: domain-b'})).toBeInTheDocument();
 history.replaceState({},'','/console/services/?connection=second');
 await select('管理域名','a.example · A');await expectContext('a.example · A','A · 已连接');
 expect(location.search).toBe('');expect(screen.getByRole('button',{name:'Edit directory: default'})).toBeInTheDocument();
});
it('switching an existing service updates the shared domain and survives a page remount',async()=>{
 const view=render(<Console section="services"/>);await expectContext('a.example · A','A · 已连接');
 await select('邮件服务','B · 已连接');await expectContext('b.example · B','B · 已连接');
 view.unmount();render(<Console section="services"/>);await expectContext('b.example · B','B · 已连接');
});
it('adopts a deep linked service into the shared console context',async()=>{
 history.replaceState({},'','/console/services/?connection=second');render(<Console section="services"/>);
 await expectContext('b.example · B','B · 已连接');
});
it('protects both selectors while directory edits are unsaved',async()=>{
 render(<Console section="services"/>);await expectContext('a.example · A','A · 已连接');
 fireEvent.click(screen.getByRole('button',{name:'Edit directory: default'}));
 expect(screen.getByRole('combobox',{name:'管理域名'})).toHaveAttribute('aria-disabled','true');
 expect(screen.getByRole('combobox',{name:'邮件服务'})).toHaveAttribute('aria-disabled','true');
});

it('lets an installed operator save a new address even when domain administration is unavailable and a legacy Site Key is invalid', async()=>{
 const previous=request.getMockImplementation()!;
 request.mockImplementation(async(path:string, options?:RequestInit)=>{
  if(path.startsWith('/admin/')||path==='/installation/connections')throw new Error('Independent service unavailable');
  if(path==='/installation/config'&&options?.method==='PATCH')return {saved:true};
  if(path==='/installation/config')return {settings:{brand:'Mail',publicOrigin:'http://192.0.2.7:8088',turnstileSiteKey:'http://192.0.2.7:8088'},turnstileSecretSet:true};
  return previous(path,options);
 });
 render(<Console section="site"/>);
 const origin=await screen.findByRole('textbox',{name:/公开访问来源/});
 fireEvent.change(origin,{target:{value:'https://webmail.example.net/'}});
 fireEvent.click(screen.getByRole('button',{name:'保存站点配置'}));
 await screen.findByText(/站点地址已保存/);
 expect(request).toHaveBeenCalledWith('/installation/config',expect.objectContaining({
  method:'PATCH',body:JSON.stringify({brand:'Mail',publicOrigin:'https://webmail.example.net'}),
 }));
 expect(screen.getByRole('link',{name:/打开已保存的主地址/})).toHaveAttribute('href','https://webmail.example.net');
});

it('keeps deployment controls hidden from ordinary mailbox users', async()=>{
 request.mockImplementation(async(path:string)=>{
  if(path==='/auth/session')return {id:'ordinary',email:'reader@a.example',operator:false};
  if(path==='/health/ready')return {version:'1',revision:'test'};
  throw new Error('Unexpected request: '+path);
 });
 render(<Console section="versions"/>);
 expect(await screen.findByRole('heading',{name:'需要控制台权限'})).toBeInTheDocument();
 expect(request.mock.calls.some(([path])=>path.startsWith('/admin/'))).toBe(false);
});
