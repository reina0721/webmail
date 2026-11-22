import { NativePaneSpinner, NativeSpinner } from "@mail-web/ui/native-controls";

export interface SpinnerProps {
  /** sm w-4 (in a button or a row), md w-6 (a pane). Default md. */
  size?: "sm" | "md";
  /** Read out instead of being silent, e.g. "Loading messages". */
  label?: string;
  className?: string;
}

/** The loading spinner (R9), backed by Material UI NativeSpinner. */
export function Spinner({ size = "md", label, className }: SpinnerProps) {
  return <NativeSpinner size={size} label={label} className={className} />;
}

/** A whole pane that is loading: one centred md spinner. */
export function PaneSpinner({ label, className }: { label?: string; className?: string }) {
  return <NativePaneSpinner label={label} className={className} />;
}
