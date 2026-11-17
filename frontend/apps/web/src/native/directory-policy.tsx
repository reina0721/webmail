'use client';
import {useEffect,useState} from 'react';
import {Action,CheckboxField,ConfirmDialog} from '@mail-web/ui';
import {api} from '@platform/lib/api';
import {useInstallationLeave} from '@platform/host/use-installation-leave';
export function ConsoleDirectory({domainId,onDirtyChange}:{domainId:string;onDirtyChange?:(dirty:boolean)=>void}){
 const[value,setValue]=useState<boolean|null>(null),[saved,setSaved]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const path='/admin/directory?domainId='+encodeURIComponent(domainId);const dirty=value!==null&&value!==saved;const leave=useInstallationLeave(dirty);
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
 async function load(){setBusy(true);setError('');try{const result=await api<{enabled:boolean}>(path);setValue(result.enabled);setSaved(result.enabled);}catch{setError('无法读取上游目录设置。请检查连接；如当前服务身份缺少权限，可重新运行自动配置升级授权。');}finally{setBusy(false);}}
 useEffect(()=>{let active=true;setValue(null);setSaved(null);setBusy(true);void api<{enabled:boolean}>(path).then(r=>{if(active){setValue(r.enabled);setSaved(r.enabled);setError('');}}).catch(()=>{if(active)setError('无法读取上游目录设置。请检查连接；如缺少权限，可重新运行自动配置升级授权。');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[path]);
 async function save(){setBusy(true);setError('');try{await api(path,{method:'PUT',body:JSON.stringify({enabled:value})});setSaved(value);}catch{setError('目录设置尚未确认生效。输入已保留，请检查服务连接或升级初始化授权后重试。');}finally{setBusy(false);}}
 return <section className="console-panel"><header><h2>同服务器用户目录</h2><p>用于收件人补全、共享对象查找和日历空闲查询。此开关影响对应 Stalwart 的全部用户，不只影响当前域名。</p></header>{error&&<p role="alert" className="console-alert">{error}</p>}{value!==null?<><CheckboxField label="允许用户查询此服务器的用户目录" checked={value} disabled={busy} onCheckedChange={setValue}/><Action loading={busy} disabled={!dirty} onPress={()=>void save()}>保存并自动应用</Action></>:<Action loading={busy} onPress={()=>void load()}>重新检查目录设置</Action>}<ConfirmDialog triggerLabel="离开" isOpen={!!leave.href} onOpenChange={v=>{if(!v)leave.cancel();}} title="离开未保存的目录设置？" description="当前修改尚未保存。" cancelLabel="继续编辑" confirmLabel="离开" onConfirm={leave.leave}/></section>;
}
