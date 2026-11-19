"use client";
import { useEffect, type ReactNode } from "react";
import { MaterialTheme } from "@mail-web/ui/theme";
import { useThemeStore } from "@/stores/theme-store";
import { sanitizeCssUrl } from "@/native/site-defaults";
import { InstallationGate } from "../features/installation";
import { useSiteSettings } from "./site-settings";

function upsertHeadLink(rel: string, href: string, type?: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]:not([data-favicon-badge])`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  if (type) el.type = type;
  if (el.getAttribute("href") !== href) el.setAttribute("href", href);
}

function upsertHeadMeta(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.name = name;
    document.head.appendChild(el);
  }
  if (el.getAttribute("content") !== content) el.setAttribute("content", content);
}

export function Providers({ children }: { children: ReactNode }) {
  const setSite = useSiteSettings((s) => s.setSite);
  const metadata = useSiteSettings((s) => s.metadata);
  const dark = useThemeStore((s) => s.resolvedTheme === "dark");

  useEffect(() => {
    const root = document.documentElement;
    const bgUrl = sanitizeCssUrl(metadata.authBackgroundUrl);
    root.style.setProperty("--auth-bg-image", `url("${bgUrl}")`);
    root.style.setProperty("--auth-bg-dim", String(metadata.authBackgroundDim / 100));
    root.style.setProperty("--auth-bg-blur", `${metadata.authBackgroundBlur}px`);
    root.dataset.authLayout = metadata.authLayout;

    const iconType = metadata.faviconUrl.toLowerCase().endsWith(".png")
      ? "image/png"
      : metadata.faviconUrl.toLowerCase().endsWith(".ico")
        ? "image/x-icon"
        : "image/svg+xml";
    upsertHeadLink("icon", metadata.faviconUrl, iconType);
    upsertHeadLink("apple-touch-icon", metadata.appleTouchIconUrl);
    upsertHeadLink("manifest", "/manifest.webmanifest");
    upsertHeadMeta("description", metadata.seoDescription);
    upsertHeadMeta("keywords", metadata.seoKeywords);
    upsertHeadMeta("robots", metadata.allowIndexing ? "index, follow" : "noindex, nofollow");
    upsertHeadMeta(
      "theme-color",
      dark ? metadata.themeColorDark : metadata.themeColorLight,
    );
  }, [metadata, dark]);

  return (
    <MaterialTheme dark={dark}>
      <InstallationGate onSite={setSite}>{children}</InstallationGate>
    </MaterialTheme>
  );
}
