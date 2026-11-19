import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./bulwark-globals.css";
import "@mail-web/ui/client.css";
import { NativeProviders as Providers } from "@/native/providers";

export const metadata: Metadata = {
  title: "Mail Web - 现代安全邮箱工作台",
  description: "支持多账户管理、日历、通讯录与云盘的一体化现代 Webmail 邮箱工作台。",
  keywords: ["webmail", "邮箱", "邮件客户端", "日历", "通讯录", "云盘"],
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/mark.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png" }],
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "Mail Web",
    title: "Mail Web - 现代安全邮箱工作台",
    description: "支持多账户管理、日历、通讯录与云盘的一体化现代 Webmail 邮箱工作台。",
    images: [{ url: "/screenshot-1280x720.png", width: 1280, height: 720 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mail Web - 现代安全邮箱工作台",
    description: "支持多账户管理、日历、通讯录与云盘的一体化现代 Webmail 邮箱工作台。",
    images: ["/screenshot-1280x720.png"],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
