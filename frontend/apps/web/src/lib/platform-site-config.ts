import {applyLiteConfig} from './lite-config';

/** Only public presentation data may be recovered from the offline cache. */
export function cachedSiteBrand(): string {
  try {
    const site = JSON.parse(localStorage.getItem('mail-web-site-status') || 'null');
    if (typeof site?.brand === 'string' && site.brand.trim()) return site.brand;
  } catch { /* No browser storage during SSR, or a damaged public cache. */ }
  return 'Mail Web';
}

export async function fetchNativeSiteConfig() {
  let brand = cachedSiteBrand();
  try {
    const response = await fetch('/api/v1/installation', {credentials: 'same-origin', signal: AbortSignal.timeout(2500)});
    if (!response.ok) throw new Error('Configuration unavailable');
    const site = await response.json();
    if (typeof site?.brand === 'string' && site.brand.trim()) brand = site.brand;
  } catch { /* Cached branding is enough to start the encrypted offline client. */ }
  // Authentication, transports and capabilities are never read from local
  // public branding data. Rust still authenticates every online request.
  return {...applyLiteConfig({appName: brand, jmapServerUrl: '/api/v1/native', allowCustomJmapEndpoint: false,
    sourceCodeUrl: 'https://github.com/reina0721/webmail', faviconUrl: '/mark.svg',
    appLogoLightUrl: '/mark.svg', appLogoDarkUrl: '/mark.svg', loginLogoLightUrl: '/mark.svg', loginLogoDarkUrl: '/mark.svg'}),
    settingsSyncEnabled: true, stalwartFeaturesEnabled: true, stalwartJmapPassthroughEnabled: true};
}
