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
