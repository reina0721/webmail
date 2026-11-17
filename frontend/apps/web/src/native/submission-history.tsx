'use client';
import {useState} from 'react';
import {useAuthStore} from '@/stores/auth-store';
import {nativeFetch} from '@/lib/platform-transport';
import {Button} from '@/components/ui/button';
import {SettingsSection} from '@/components/settings/settings-section';
type Record={id:string;status:string;createdAt:number;checkedAt:number|null;outcome:{state:string;submissions:unknown[]}|null};
export function SubmissionHistory(){
 const username=useAuthStore(s=>s.username);const[open,setOpen]=useState(false),[items,setItems]=useState<Record[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState('');
 async function request(path:string,method='GET'){const response=await nativeFetch('/api/v1/client/submissions'+path,{method,headers:{'X-Mail-Account':username??''}});const body=await response.json();if(!response.ok)throw new Error(body.code==='submission_not_found'?'记录不存在或已不属于当前账号':'暂时无法读取提交状态，请重试');return body;}
 async function load(){setBusy('load');setError('');try{setItems((await request('')).items);setOpen(true);}catch(e){setError(e instanceof Error?e.message:'连接失败');}finally{setBusy('');}}
 async function reconcile(id:string){setBusy(id);setError('');try{const outcome=await request('/'+encodeURIComponent(id)+'/reconcile','POST');setItems(current=>current.map(item=>item.id===id?{...item,outcome,checkedAt:Date.now()}:item));}catch(e){setError(e instanceof Error?e.message:'核对失败');}finally{setBusy('');}}
 return <SettingsSection title="发送提交记录" description="网络响应丢失时，先核对上游记录；不自动重发结果未知的邮件。"><div className="space-y-4"><Button variant="outline" disabled={!!busy} onClick={()=>void load()}>{open?'刷新记录':'查看最近提交'}</Button>{error&&<p role="alert" className="text-destructive">{error}</p>}{open&&<div className="overflow-x-auto"><table className="console-table"><thead><tr><th>提交时间</th><th>状态</th><th>核对</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><time>{new Date(item.createdAt).toLocaleString()}</time><small>{item.id.slice(0,12)}</small></td><td>{item.outcome?.state==='accepted'?'已核对：上游已接受':item.outcome?.state==='unconfirmed'?'结果仍待确认':item.status==='complete'?'已记录上游响应':'结果待核对'}</td><td><Button size="sm" variant="ghost" disabled={!!busy} onClick={()=>void reconcile(item.id)}>{busy===item.id?'核对中…':'核对上游'}</Button></td></tr>)}</tbody></table>{!items.length&&<p>暂无原生客户端提交记录。</p>}</div>}</div></SettingsSection>;
}
