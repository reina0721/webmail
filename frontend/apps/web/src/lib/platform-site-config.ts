import { applyLiteConfig } from "./lite-config";
import {
  mergeSiteMetadata,
  readCachedSiteMetadata,
  writeCachedSiteMetadata,
  type SiteMetadata,
} from "@/native/site-defaults";

/** Only public presentation data may be recovered from the offline cache. */
export function cachedSiteBrand(): string {
  return readCachedSiteMetadata().brand;
}

export async function fetchPublicSiteMetadata(): Promise<SiteMetadata> {
  let metadata = readCachedSiteMetadata();
  try {
    const response = await fetch("/api/v1/site", {
      credentials: "same-origin",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      metadata = mergeSiteMetadata(await response.json());
      writeCachedSiteMetadata(metadata);
      return metadata;
    }
  } catch {
    /* Fall back to installation status or offline cache. */
  }
  try {
    const response = await fetch("/api/v1/installation", {
      credentials: "same-origin",
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) {
      const site = await response.json();
      if (typeof site?.brand === "string" && site.brand.trim()) {
        metadata = mergeSiteMetadata({ ...metadata, brand: site.brand });
      }
    }
  } catch {
    /* Cached branding is enough to start the encrypted offline client. */
  }
  return metadata;
}

export async function fetchNativeSiteConfig() {
  const site = await fetchPublicSiteMetadata();
  // Authentication, transports and capabilities are never read from local
  // public branding data. Rust still authenticates every online request.
  return {
    ...applyLiteConfig({
      appName: site.brand,
      jmapServerUrl: "/api/v1/native",
      allowCustomJmapEndpoint: false,
      sourceCodeUrl: site.sourceCodeUrl,
      faviconUrl: site.faviconUrl,
      appLogoLightUrl: site.appLogoLightUrl,
      appLogoDarkUrl: site.appLogoDarkUrl,
      loginLogoLightUrl: site.loginLogoLightUrl,
      loginLogoDarkUrl: site.loginLogoDarkUrl,
      loginCompanyName: site.organizationName,
      loginWebsiteUrl: site.websiteUrl,
      loginPrivacyPolicyUrl: site.privacyPolicyUrl,
      loginImprintUrl: site.imprintUrl,
      helpUrl: site.helpUrl,
      accessibilityFeedbackUrl: site.supportUrl,
      accountManagementUrl: site.accountManagementUrl,
      accountManagementLabel: site.accountManagementLabel,
    }),
    settingsSyncEnabled: true,
    stalwartFeaturesEnabled: true,
    stalwartJmapPassthroughEnabled: true,
  };
}
