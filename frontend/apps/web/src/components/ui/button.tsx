"use client";
// Adapted from Bulwark: preserve its business-facing API; Material owns the control.
export {NativeButton as Button} from '@mail-web/ui/native-controls';
export type {NativeButtonProps as ButtonProps,NativeButtonSize as ButtonSize} from '@mail-web/ui/native-controls';
export const TOUCH_HIT_AREA =
  "relative large-targets:after:absolute large-targets:after:top-1/2 large-targets:after:left-1/2 " +
  "large-targets:after:size-full large-targets:after:min-h-11 large-targets:after:min-w-11 " +
  "large-targets:after:-translate-x-1/2 large-targets:after:-translate-y-1/2";

