import {create} from 'zustand';
export const useNativeSession=create<{operator:boolean;setOperator:(value:boolean)=>void}>(set=>({operator:false,setOperator:operator=>set({operator})}));

import {persist} from 'zustand/middleware';
export const useConsoleDomain=create<{domain:string;setDomain:(domain:string)=>void}>()(persist(set=>({domain:'default',setDomain:domain=>set({domain})}),{name:'mail-web-console-domain'}));
