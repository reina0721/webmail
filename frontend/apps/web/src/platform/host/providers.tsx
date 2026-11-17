"use client";
import {useEffect,type ReactNode} from 'react';
import {MaterialTheme} from '@mail-web/ui/theme';
import {useThemeStore} from '@/stores/theme-store';
import {InstallationGate} from '../features/installation';
import {useSiteSettings} from './site-settings';
export function Providers({children}:{children:ReactNode}){const setSite=useSiteSettings(s=>s.setSite);const brand=useSiteSettings(s=>s.brand);const dark=useThemeStore(s=>s.resolvedTheme==='dark');useEffect(()=>{document.title=brand;},[brand]);return <MaterialTheme dark={dark}><InstallationGate onSite={setSite}>{children}</InstallationGate></MaterialTheme>;}
