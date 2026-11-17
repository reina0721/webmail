'use client';
import {ServiceWorkerRegistration} from '@/components/service-worker-registration';
import {AppLockGate} from '@/components/app-lock/app-lock-gate';
import {useEffect,type ReactNode} from 'react';
import {configureAccountContext} from '@platform/lib/api';
import {useAccountStore} from '@/stores/account-store';
import {useAuthStore} from '@/stores/auth-store';
import {useNativeSession} from '@/stores/native-host-store';
import {nativeFetch,isNativeServer,configureNativeAccountContext} from '@/lib/platform-transport';
import {Providers as PlatformProviders} from '@platform/host/providers';
import {IntlProvider} from '@/components/providers/intl-provider';
import {ThemeProvider} from '@/components/providers/theme-provider';
import {CalendarAlertProvider} from '@/components/providers/calendar-alert-provider';
import {RateLimitToastProvider} from '@/components/providers/rate-limit-toast-provider';
import {TourProvider} from '@/components/tour/tour-provider';
import {ProtocolLaunchHandlerProvider} from '@/components/protocol/protocol-launch-handler-provider';
import {ExternalRecipientConfirmHost} from '@/components/email/external-recipient-confirm';
import {AccessibilityQuickPanelHost} from '@/components/accessibility/accessibility-quick-panel';
import {QuickRuleHost} from '@/components/filters/quick-rule-host';
import {PaneCycleHost} from '@/components/layout/pane-cycle';
import {FocusRescueHost} from '@/components/layout/focus-rescue';
import {AccountTemplateSync} from '@/components/templates/account-template-sync';
import {DeferredOfflineHost,DeferredMailTransferHost,DeferredFileDropHost} from '@/components/providers/deferred-hosts';
import {NativeWebHosts} from './web-hosts';
import {rememberNativeSelection} from './session-selection';
import {mergeMessages} from '@/i18n/merge-messages';
import english from '@/locales/en/common.json';
import messages from '@/locales/zh/common.json';
const catalog=mergeMessages(english,messages);
configureAccountContext(()=>{const state=useAccountStore.getState();return state.getAccountById(state.activeAccountId??'')?.username;});
configureNativeAccountContext(()=>{const state=useAccountStore.getState();return state.getAccountById(state.activeAccountId??'')?.username;});
function SessionContext(){
 const username=useAuthStore(s=>s.username);const server=useAuthStore(s=>s.serverUrl);
 useEffect(rememberNativeSelection,[]);
 useEffect(()=>{if(username&&isNativeServer(server))void useAuthStore.getState().checkAuth().catch(()=>{});},[username,server]);
 useEffect(()=>{let live=true;useNativeSession.getState().setOperator(false);if(!username||!isNativeServer(server))return;void nativeFetch('/api/v1/auth/session',{headers:{'X-Mail-Account':username}}).then(async r=>{if(!r.ok)throw new Error('Session unavailable');const session=await r.json();if(live)useNativeSession.getState().setOperator(session.operator===true);}).catch(()=>{});return()=>{live=false;};},[username,server]);return null;
}
export function NativeProviders({children}:{children:ReactNode}){return <PlatformProviders><IntlProvider locale="zh" messages={catalog}><ThemeProvider><AppLockGate><CalendarAlertProvider><RateLimitToastProvider><TourProvider><ProtocolLaunchHandlerProvider><SessionContext/><NativeWebHosts/>{children}<AccountTemplateSync/><AccessibilityQuickPanelHost/><QuickRuleHost/><PaneCycleHost/><FocusRescueHost/><ExternalRecipientConfirmHost/><DeferredMailTransferHost/><DeferredFileDropHost/><DeferredOfflineHost/><ServiceWorkerRegistration/></ProtocolLaunchHandlerProvider></TourProvider></RateLimitToastProvider></CalendarAlertProvider></AppLockGate></ThemeProvider></IntlProvider></PlatformProviders>;}
