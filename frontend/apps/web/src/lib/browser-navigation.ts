import {nativeFetch} from '@/lib/platform-transport';
import { locales } from '@/i18n/routing';
import { getLiteMount } from '@/lib/lite';

export function replaceWindowLocation(url: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.replace(url);
}

// Build-time constant injected by next.config.ts. When the app is built with
// NEXT_PUBLIC_BASE_PATH=/webmail, Next.js itself prefixes routes and assets;
// helpers below use the same value so client code stays consistent.
const STATIC_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

/**
 * Returns the mount prefix the app is served at.
 *
 * Resolution order:
 *  1. The build-time `NEXT_PUBLIC_BASE_PATH` constant (set in next.config.ts).
 *  2. Runtime detection from `window.location.pathname` for legacy deploys
 *     where the reverse proxy mounts the app at a subpath without rebuilding.
 *
 * If a locale is supplied (e.g. from route params) it anchors the runtime
 * detection; otherwise the first path segment that matches a known locale is
 * used.
 *
 * Returns '' when there is no prefix.
 */
export function getPathPrefix(locale?: string): string {
  if (STATIC_BASE_PATH) return STATIC_BASE_PATH;
  if (typeof window === 'undefined') return '';
  // Lite on Stalwart: the entry document read the prefix from <base href>,
  // which works for URLs without a locale segment too (`/webmail/`).
  const liteMount = getLiteMount();
  if (liteMount !== null) return liteMount;

  const segments = window.location.pathname.split('/').filter(Boolean);

  let localeIndex: number;
  if (locale) {
    localeIndex = segments.indexOf(locale);
  } else {
    localeIndex = segments.findIndex(s =>
      (locales as readonly string[]).includes(s)
    );
  }

  if (localeIndex <= 0) return '';
  return '/' + segments.slice(0, localeIndex).join('/');
}

/**
 * Mount-prefix-aware wrapper around `fetch()`.
 *
 * When Bulwark is served behind a reverse proxy at a sub-path (e.g. `/bulwark`),
 * `fetch('/api/foo')` would target the browser origin at `/api/foo`, which the
 * proxy doesn't route. `apiFetch` detects the mount prefix from
 * `window.location.pathname` via `getPathPrefix()` at call time, so the same
 * built bundle works at any mount point without rebuilding.
 *
 * Only rewrites absolute paths that start with a single `/`. Protocol-relative
 * URLs (`//cdn.example.com/foo`) and absolute URLs (`https://...`) pass
 * through unchanged.
 *
 * Server code (route handlers, layout files running at SSR) should keep using
 * the raw Fetch API - the mount prefix is a browser-only concept.
 *
 * @example
 *   await apiFetch('/api/jmap', { method: 'POST', body })
 *   // Browser at /webmail/en/inbox  → /webmail/api/jmap
 *   // Browser at /en/inbox          → /api/jmap
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if(input==='/api/offline/shell')return fetch('/offline-shell.json',init);
  if(input==='/api/version')return fetch('/build.json',init);
  if(input==='/api/settings' || input==='/api/account/stalwart/jmap') return import('@/stores/account-store').then(({useAccountStore})=>{
    const headers=new Headers(init?.headers);const slot=headers.get('X-JMAP-Cookie-Slot');const state=useAccountStore.getState();
    const requested=headers.get('x-settings-username');
    const account=requested?state.accounts.find(a=>a.username===requested):slot!==null?state.accounts.find(a=>a.cookieSlot===Number(slot)):state.getAccountById(state.activeAccountId??'');
    if(account && !account.serverUrl.endsWith('/api/v1/native'))return fetch(getPathPrefix()+input,init);
    if(account)headers.set('X-Mail-Account',account.username);
    return nativeFetch(input==='/api/settings'?'/api/v1/client/preferences':'/api/v1/client/account', {...init,headers,method:input==='/api/settings'&&init?.method==='POST'?'PUT':init?.method});
  });
  if(input==='/api/fetch-ical') return import('@platform/lib/api').then(({platformHeaders})=>{const headers=new Headers(init?.headers);platformHeaders(headers);return nativeFetch('/api/v1/client/calendar-feed',{...init,headers}).then(async response=>{
      if(response.ok)return response;
      const body=await response.clone().json().catch(()=>null);if(!body?.code)return response;
      const messages:Record<string,string>={calendar_url_disallowed:'这个地址不能用于远程日历。仅允许可验证的公网 HTTP 或 HTTPS 地址。',calendar_lookup_failed:'暂时无法解析日历服务器，请稍后重试。',calendar_feed_too_large:'这个日历超过 25 MiB 限制。',calendar_content_invalid:'此地址没有返回有效的 iCalendar 文件。',calendar_fetch_timeout:'日历服务器响应超时，稍后可以重试。',calendar_fetch_busy:'日历刷新任务较多，请稍后重试。'};
      return Response.json({error:messages[body.code]??'暂时无法获取远程日历，请稍后重试。'},{status:response.status});
    });});
  if(input==='/api/account-archive') {
    const headers=new Headers(init?.headers);const username=headers.get('x-archive-username');
    if(username)headers.set('X-Mail-Account',username);
    return nativeFetch('/api/v1/client/account-archive',{...init,headers}).then(async response=>{
      if(response.ok)return response;
      const error=response.status===403||response.status===401?'owner_signin_required':response.status===413?'too_large':response.status>=500?'storage_unavailable':'invalid_archive';
      return Response.json({error},{status:response.status});
    });
  }
  if(input==='/api/admin/policy') return Promise.all([import('@/lib/admin/types'),import('@/stores/account-store')]).then(async ([{DEFAULT_POLICY},{useAccountStore}])=>{
    const state=useAccountStore.getState();const active=state.getAccountById(state.activeAccountId??'');
    const response=await nativeFetch('/api/v1/client/policy',{...init,headers:active?{'X-Mail-Account':active.username}:{},signal:AbortSignal.any([AbortSignal.timeout(2500),...(init?.signal?[init.signal]:[])])});
    if(!response.ok && response.status!==401)return response;
    const policy=response.ok?await response.json():{};
    return Response.json({...DEFAULT_POLICY,...policy,features:{...DEFAULT_POLICY.features,accountArchiveEnabled:true,accountArchivePasswordsEnabled:false,allMailViewEnabled:true,crossUnreadViewEnabled:true,crossStarredViewEnabled:true,crossAllViewEnabled:true,unifiedCrossAccountEnabled:true}},response.status===401?{headers:{'X-Bulwark-Policy-Scope':'public'}}:undefined);
  });
  if (input.startsWith('/') && !input.startsWith('//')) {
    return fetch(getPathPrefix() + input, init);
  }
  return fetch(input, init);
}

/**
 * Mount-prefix-aware wrapper for URL strings used in `<img src>`, `<link href>`,
 * `window.location.*`, etc. — anything the browser resolves itself, where
 * `apiFetch` can't help.
 *
 * Idempotent: passing an already-prefixed value, an external URL, a
 * protocol-relative URL, or an empty/falsy value returns it unchanged. So it's
 * safe to wrap admin-configurable values that might be either a local path
 * (`/branding/foo.svg`, `/api/admin/branding/...`) or a full URL.
 */
export function withBasePath(url: string | null | undefined): string {
  if (!url) return url ?? '';
  if (url.charCodeAt(0) !== 47) return url;        // not absolute (e.g. https://, data:, blob:)
  if (url.charCodeAt(1) === 47) return url;        // protocol-relative //cdn...
  const prefix = getPathPrefix();
  if (!prefix) return url;
  if (url === prefix || url.startsWith(prefix + '/')) return url;
  return prefix + url;
}


/**
 * Converts a browser-style path (as found in `window.location.pathname`,
 * which always includes the mount prefix) into a path safe to hand to Next's
 * client router (`router.push` / `router.replace`).
 *
 * When the app is built with NEXT_PUBLIC_BASE_PATH, Next's router prepends
 * the basePath itself, so a stored prefixed path would get it twice (#390) —
 * strip it here. Legacy runtime-detected proxy mounts pass through unchanged:
 * Next knows nothing about that prefix, so the router needs the full path.
 *
 * Accepts paths with query/hash suffixes (`/webmail/en/calendar?view=day`).
 */
export function toRouterPath(path: string): string {
  if (!STATIC_BASE_PATH || !path.startsWith(STATIC_BASE_PATH)) return path;
  const rest = path.slice(STATIC_BASE_PATH.length);
  if (rest === '') return '/';
  if (rest[0] === '/') return rest;
  if (rest[0] === '?' || rest[0] === '#') return '/' + rest;
  return path; // different first segment that merely shares the prefix text
}

/**
 * Extracts the locale from the current URL, skipping any mount prefix.
 * Falls back to 'en' when no known locale segment is found.
 */
export function getLocaleFromPath(): string {
  if (typeof window === 'undefined') return 'en';

  const segments = window.location.pathname.split('/').filter(Boolean);
  const locale = segments.find(s =>
    (locales as readonly string[]).includes(s)
  );
  return locale || 'en';
}