"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Action, Box, ConsoleStatusBanner, LinearProgress } from "@mail-web/ui";
import { api, errorMessage } from "../lib/api";
import type { components } from "../lib/generated-api";
import { fetchPublicSiteMetadata } from "@/lib/platform-site-config";
import { useSiteSettings } from "../host/site-settings";

type Status = components["schemas"]["InstallationStatus"];
export function InstallationGate({
  children,
  onSite,
}: {
  children: ReactNode;
  onSite: (site: { brand: string; domain: string }) => void;
}) {
  const pathname = usePathname();
  const setMetadata = useSiteSettings((s) => s.setMetadata);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void api<Status>("/installation", { signal: AbortSignal.timeout(2500) })
      .then((value) => {
        if (!active) return;
        setStatus(value);
        localStorage.setItem("mail-web-site-status", JSON.stringify(value));
        const brand = value.brand || "Mail Web";
        onSite({ brand, domain: value.domain });
        void fetchPublicSiteMetadata().then((metadata) => {
          if (active) setMetadata(metadata);
        });
      })
      .catch((e) => {
        if (!active) return;
        try {
          const cached = JSON.parse(
            localStorage.getItem("mail-web-site-status") || "null",
          );
          if (cached?.configured && !cached.needsOperator) {
            setStatus(cached);
            onSite({ brand: cached.brand || "Mail Web", domain: cached.domain });
            void fetchPublicSiteMetadata().then((metadata) => {
              if (active) setMetadata(metadata);
            });
            return;
          }
        } catch {
          /* Ignore unreadable local site status cache. */
        }
        setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [revision, onSite, setMetadata]);
  if (error)
    return (
      <main className="installation-shell" role="alert">
        <div className="native-loading-card">
          <span className="native-mark" aria-hidden="true">
            ✦
          </span>
          <h1 className="auth-title">无法读取站点配置</h1>
          <ConsoleStatusBanner severity="error">{error}</ConsoleStatusBanner>
          <Action onPress={() => setRevision((n) => n + 1)}>重新连接</Action>
        </div>
      </main>
    );
  if (!status)
    return (
      <main className="installation-shell" role="status" aria-busy="true">
        <div className="native-loading-card">
          <span className="native-mark" aria-hidden="true">
            ✦
          </span>
          <p className="muted">正在读取站点配置…</p>
          <Box sx={{ width: "100%" }}>
            <LinearProgress />
          </Box>
        </div>
      </main>
    );
  if (!status.configured || status.needsOperator)
    return pathname.startsWith("/console") ? children : <SetupRedirect />;
  return children;
}

function SetupRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/console/setup/");
  }, [router]);
  return (
    <main className="native-loading" role="status" aria-busy="true">
      <div className="native-loading-card">
        <span className="native-mark" aria-hidden="true">
          ✦
        </span>
        <p className="muted">正在进入自动安装…</p>
        <Box sx={{ width: "100%" }}>
          <LinearProgress />
        </Box>
      </div>
    </main>
  );
}
