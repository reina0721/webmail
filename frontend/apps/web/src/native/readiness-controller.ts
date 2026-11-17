'use client';
import {useEffect,useRef,useState} from 'react';
import {Action} from '@mail-web/ui/action';
import {api,errorMessage} from '@platform/lib/api';
type Report={healthy:boolean;stale:boolean;lastSuccessAt:number;consecutiveFailures:number;requestedEnabled:boolean;effectiveEnabled:boolean;ready:boolean;items:{id:string;label:string;status:string;reason?:string}[];checkedAt:number;humanVerifiedAt:number;releaseVersion:string;protocolScope:string;serviceId:string};
const reasons:Record<string,string>={configuration_fields_missing:'请在配置页补齐运行凭据',required_permissions_missing:'运行密钥缺少必要权限，请重新授权修复',credential_rejected:'运行凭据已失效，请在配置页更新',domain_mismatch:'域名名称与保存的 ID 不一致',sender_mailbox_missing:'验证码发件账号没有可用的邮件文件夹',sender_identity_missing:'未找到匹配的验证邮件发件身份',hook_identity_ambiguous:'同一服务的账号标识存在冲突，无法安全计算发信限额',hook_configuration_mismatch:'Hook 的回调、认证、阶段或账号范围不匹配',callback_unreachable:'无法访问配置的网站回调',callback_authentication_failed:'网站回调认证未通过',turnstile_missing:'请配置 Turnstile Site Key 和 Secret'};
export function useReadiness({token='',domainId='default',embedded=false,requestedEnabled,onChange}:{token?:string;domainId?:string;embedded?:boolean;requestedEnabled?:boolean;onChange?:(ready:boolean)=>void}){
 const[value,setValue]=useState<Report|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[url,setUrl]=useState('');
 const generation=useRef(0),alive=useRef(false);
 const headers=()=>token?{Authorization:'Bearer '+token}:undefined;
 async function load(){const request=generation.current;try{const report=await api<Report>('/installation/readiness?domainId='+encodeURIComponent(domainId),{headers:headers()});if(!alive.current||request!==generation.current)return;setValue(report);setError('');onChange?.(report.ready);}catch(e){if(!alive.current||request!==generation.current)return;setValue(null);setError(errorMessage(e));onChange?.(false);}}
 useEffect(()=>{alive.current=true;generation.current++;setPending(false);setValue(null);setUrl('');void load();return()=>{alive.current=false;generation.current++;};},[token,domainId,requestedEnabled]);
 async function run(createLink=false){const request=generation.current;setPending(true);setError('');try{if(createLink){const result=await api<{url:string}>('/installation/readiness/link?domainId='+encodeURIComponent(domainId),{method:'POST',headers:headers()});if(alive.current&&request===generation.current)setUrl(result.url);}else await api('/installation/readiness?domainId='+encodeURIComponent(domainId),{method:'POST',headers:headers()});if(alive.current&&request===generation.current)await load();}catch(e){if(alive.current&&request===generation.current)setError(errorMessage(e));}finally{if(alive.current&&request===generation.current)setPending(false);}}
 return {value,pending,error,url,load,run,reasons};
}
