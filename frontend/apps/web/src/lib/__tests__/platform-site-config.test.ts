import {afterEach, describe, expect, it, vi} from 'vitest';
import {cachedSiteBrand, fetchNativeSiteConfig} from '../platform-site-config';

afterEach(() => {localStorage.clear(); vi.unstubAllGlobals();});
describe('native public branding during offline startup', () => {
  it.each([502, 401])('recovers branding on HTTP %s without trusting cached authentication or endpoints', async status => {
    localStorage.setItem('mail-web-site-status', JSON.stringify({brand: '桜 Mail', oauthOnly: true,
      allowCustomJmapEndpoint: true, jmapServerUrl: 'https://foreign.invalid', operator: true}));
    const fetch = vi.fn().mockResolvedValue(new Response(null, {status})); vi.stubGlobal('fetch', fetch);
    const config = await fetchNativeSiteConfig();
    expect(config.appName).toBe('桜 Mail');
    expect(config.jmapServerUrl).toBe('/api/v1/native');
    expect(config.allowCustomJmapEndpoint).toBe(false);
    expect(config.oauthOnly).toBe(false);
    expect(config).not.toHaveProperty('operator');
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('starts with safe defaults if storage and the network fail, and uses current online branding when available', async () => {
    localStorage.setItem('mail-web-site-status', '{broken');
    expect(cachedSiteBrand()).toBe('Mail Web');
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({brand: 'Current Mail'})));
    vi.stubGlobal('fetch', fetch);
    expect((await fetchNativeSiteConfig()).appName).toBe('Mail Web');
    expect((await fetchNativeSiteConfig()).appName).toBe('Current Mail');
  });
});
