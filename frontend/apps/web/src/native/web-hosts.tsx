'use client';

// Web hosts from Bulwark's pinned app/(main)/[locale]/layout.tsx.
// Keep these at app scope: a surface-only mount loses background account,
// calendar, file and notification events whenever that surface is unmounted.
import {PushBindingsHost} from '@/components/providers/push-bindings-host';
import {CommandPaletteHost} from '@/components/command-palette/command-palette';
import {MainWindowOnly} from '@/components/popout/main-window-only';
import {WindowSyncHost} from '@/components/popout/window-sync-host';
import {FreeBusyAutoShare} from '@/components/calendar/free-busy-auto-share';
import {SessionTimeoutGuard} from '@/components/session/session-timeout-guard';
import {DevicePolicyHost} from '@/components/device/device-policy-host';
import {PhishingReportHost} from '@/components/email/phishing-report-host';
import {PWAInstallPrompt} from '@/components/pwa-install-prompt';
import {AppUpdatePrompt} from '@/components/app-update-prompt';
import {PushNotificationPrompt} from '@/components/push-notification-prompt';
import {
 DeferredNotificationActionsHost,
 DeferredAccountArchiveRestorePrompt,
 DeferredSettingsSyncOffer,
 DeferredPopoutHost,
} from '@/components/providers/deferred-hosts';

export function NativeWebHosts(){
 return <>
  <MainWindowOnly>
   <PushBindingsHost/>
   <CommandPaletteHost/>
   <FreeBusyAutoShare/>
   <DeferredPopoutHost/>
   <PWAInstallPrompt/>
   <AppUpdatePrompt/>
   <PushNotificationPrompt/>
   <DeferredAccountArchiveRestorePrompt/>
   <DeferredSettingsSyncOffer/>
  </MainWindowOnly>
  <WindowSyncHost/>
  <SessionTimeoutGuard/>
  <DevicePolicyHost/>
  <PhishingReportHost/>
  <DeferredNotificationActionsHost/>
 </>;
}
