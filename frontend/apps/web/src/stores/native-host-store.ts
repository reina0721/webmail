import {create} from 'zustand';
export const useNativeSession=create<{operator:boolean;setOperator:(value:boolean)=>void}>(set=>({operator:false,setOperator:operator=>set({operator})}));

import {persist} from 'zustand/middleware';
export const useConsoleDomain=create<{domain:string;setDomain:(domain:string)=>void}>()(persist(set=>({domain:'default',setDomain:domain=>set({domain})}),{name:'mail-web-console-domain'}));

export const useConsoleSidebar=create<{
 collapsed:boolean|null;
 setCollapsed:(collapsed:boolean)=>void;
 expandedGroups:Record<string,boolean>;
 toggleGroup:(id:string)=>void;
 setGroupExpanded:(id:string,expanded:boolean)=>void;
}>()(persist(set=>({
 collapsed:null,
 setCollapsed:collapsed=>set({collapsed}),
 expandedGroups:{site:true,activity:false},
 toggleGroup:id=>set(state=>({expandedGroups:{...state.expandedGroups,[id]:!state.expandedGroups[id]}})),
 setGroupExpanded:(id,expanded)=>set(state=>({expandedGroups:{...state.expandedGroups,[id]:expanded}})),
}),{name:'mail-web-console-sidebar'}));
