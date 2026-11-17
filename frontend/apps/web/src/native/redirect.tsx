"use client";
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
export function ConsoleRedirect({setup=false}:{setup?:boolean}){const router=useRouter();useEffect(()=>{const q=new URLSearchParams(location.search);const section=q.get('section');const dest=setup?'/console/setup/':section==='registration'?'/console/registration/':'/console/';router.replace(dest+location.hash);},[router,setup]);return <main className="native-loading" role="status">正在打开统一控制台…</main>;}

export function NativeRedirect({href}:{href:string}){const router=useRouter();useEffect(()=>{router.replace(href+location.search+location.hash);},[href,router]);return <main className="native-loading" role="status">正在打开工作区…</main>;}
