import type { ReactNode } from "react";
import { NativeEmptyState } from "@mail-web/ui/native-controls";
import type { AppIcon } from "@/components/icons";

export interface EmptyStateProps {
  /** Drawn in a muted circle above the title. */
  icon?: AppIcon;
  title: ReactNode;
  /** One line under the title: why it is empty or what to do. */
  description?: ReactNode;
  /**
   * Buttons under the text: the create action as `<Button size="sm">`, a
   * secondary one (Clear search) as `<Button variant="outline" size="sm">`.
   */
  actions?: ReactNode;
  /** Less padding, for a narrow pane or a popover. */
  compact?: boolean;
  className?: string;
}

/**
 * A list or pane with nothing in it (R9), backed by Material UI NativeEmptyState.
 */
export function EmptyState({ icon: Icon, title, description, actions, compact = false, className }: EmptyStateProps) {
  return (
    <NativeEmptyState
      icon={Icon ? <Icon className="w-6 h-6" aria-hidden="true" /> : undefined}
      title={title}
      description={description}
      actions={actions}
      compact={compact}
      className={className}
    />
  );
}
