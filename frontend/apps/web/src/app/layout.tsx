import type { ReactNode } from 'react';
import './bulwark-globals.css';
import '@mail-web/ui/client.css';
import {NativeProviders as Providers} from '@/native/providers';
export const metadata = { title: 'Mail Web', description: '邮箱工作台' };
export default function Layout({children}:{children:ReactNode}) { return <html lang="zh-CN"><body className="bg-background text-foreground"><Providers>{children}</Providers></body></html>; }
