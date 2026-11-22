"use client";
import type { ReactNode } from "react";
import {
  DarkModeOutlined,
  IconButton,
  LightModeOutlined,
  Tooltip,
} from "@mail-web/ui";
import { useSiteSettings } from "@platform/host/site-settings";
import { useThemeStore } from "@/stores/theme-store";

export function AuthShell({
  brand,
  children,
}: {
  brand?: ReactNode;
  children: ReactNode;
}) {
  const site = useSiteSettings((s) => s.metadata);
  const dark = useThemeStore((s) => s.resolvedTheme === "dark");
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <main className="auth-shell">
      <div aria-hidden="true" className="auth-backdrop" />
      <section className="auth-card">
        <div className="auth-card-toolbar">
          <div>{brand}</div>
          <Tooltip title={dark ? "切换为浅色模式" : "切换为深色模式"}>
            <IconButton
              type="button"
              size="small"
              aria-label={dark ? "切换为浅色模式" : "切换为深色模式"}
              onClick={() => setTheme(dark ? "light" : "dark")}
            >
              {dark ? (
                <LightModeOutlined fontSize="small" />
              ) : (
                <DarkModeOutlined fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </div>
        {site.announcementEnabled && site.announcementText.trim() && (
          <div
            className="auth-announcement"
            data-tone={site.announcementTone}
            role="status"
          >
            {site.announcementText}
          </div>
        )}
        {children}
      </section>
    </main>
  );
}
