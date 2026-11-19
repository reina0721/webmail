"use client";
import type { ReactNode } from "react";
import { useSiteSettings } from "@platform/host/site-settings";

export function AuthShell({ children }: { children: ReactNode }) {
  const site = useSiteSettings((s) => s.metadata);
  return (
    <main className="auth-shell">
      <div aria-hidden="true" className="auth-backdrop" />
      <section className="auth-card">
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
