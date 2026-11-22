"use client";
import {
  useId,
  useCallback,
  forwardRef,
  type ButtonHTMLAttributes,
  type FormEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import {
  Box,
  Button as MuiButton,
  Dialog as MuiDialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputBase,
  Paper,
  Typography,
  useMediaQuery,
} from "@mui/material";

export type NativeButtonSize =
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "icon"
  | "icon-sm"
  | "icon-lg";

export interface NativeButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline" | "destructive";
  size?: NativeButtonSize;
}

const TOUCH_TARGET_CLASSES =
  "large-targets:after:absolute large-targets:after:top-1/2 large-targets:after:left-1/2 " +
  "large-targets:after:size-full large-targets:after:min-h-11 large-targets:after:min-w-11 " +
  "large-targets:after:-translate-x-1/2 large-targets:after:-translate-y-1/2";

export const NativeButton = forwardRef<HTMLButtonElement, NativeButtonProps>(
  function NativeButton(
    { variant = "default", size = "md", className = "", color: _color, ...props },
    ref,
  ) {
    const icon = size.startsWith("icon");
    const height = {
      xs: 32,
      sm: 36,
      md: 40,
      lg: 44,
      icon: 40,
      "icon-sm": 32,
      "icon-lg": 44,
    }[size];
    const positionClass = !/\b(?:absolute|fixed|sticky)\b/.test(className)
      ? "relative "
      : "";
    return (
      <MuiButton
        disableRipple
        {...props}
        ref={ref}
        variant={
          variant === "outline"
            ? "outlined"
            : variant === "ghost"
              ? "text"
              : "contained"
        }
        color={variant === "destructive" ? "error" : "primary"}
        className={`mail-button ${positionClass}${TOUCH_TARGET_CLASSES} ${className}`.trim()}
        sx={{
          minWidth: icon ? height : 0,
          width: icon ? height : undefined,
          minHeight: height,
          height,
          padding: icon ? 0 : size === "xs" ? "0 10px" : undefined,
          borderRadius: "8px",
          lineHeight: 1.35,
          flexShrink: 0,
          fontSize: 13,
          gap: 0.75,
          "& svg": { width: 17, height: 17 },
          ...(variant === "ghost"
            ? {
                color: "inherit",
                "&:hover": {
                  backgroundColor: "var(--accent-hover-overlay)",
                },
              }
            : {}),
          ...(variant === "outline"
            ? {
                borderColor: "var(--line-strong)",
                backgroundColor: "var(--surface-card)",
                color: "var(--ink)",
                "&:hover": {
                  borderColor: "var(--accent-30)",
                  backgroundColor: "var(--accent-hover-overlay)",
                },
              }
            : {}),
        }}
      />
    );
  },
);

export interface NativeIconButtonProps
  extends Omit<NativeButtonProps, "aria-label"> {
  label: string;
  children?: ReactNode;
}

export const NativeIconButton = forwardRef<
  HTMLButtonElement,
  NativeIconButtonProps
>(function NativeIconButton(
  {
    label,
    variant = "ghost",
    size = "icon-sm",
    type = "button",
    title,
    children,
    ...props
  },
  ref,
) {
  return (
    <NativeButton
      ref={ref}
      type={type}
      variant={variant}
      size={size}
      aria-label={label}
      title={title ?? label}
      {...props}
    >
      {children}
    </NativeButton>
  );
});

export const NativeInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function NativeInput({ className = "", style, ...props }, ref) {
  const compact = className.includes("h-8");
  return (
    <InputBase
      inputRef={ref}
      disabled={props.disabled}
      className="mail-input"
      inputProps={{ ...props, className, style }}
      sx={{
        border: "1px solid var(--line)",
        borderRadius: "8px",
        backgroundColor: "var(--surface-inset)",
        padding: 0,
        fontSize: 13.5,
        minWidth: 0,
        minHeight: compact ? 32 : 38,
        height: compact ? 32 : 38,
        width: "100%",
        transition:
          "border-color var(--motion-fast) var(--ease-expo-out), background-color var(--motion-fast) var(--ease-expo-out), box-shadow var(--motion-base) var(--ease-expo-out)",
        "&:hover:not(.Mui-disabled):not(.Mui-focused)": {
          borderColor: "var(--line-strong)",
          backgroundColor: "var(--surface-card)",
        },
        "&:focus-within": {
          borderColor: "var(--accent-50)",
          backgroundColor: "var(--surface-card)",
          boxShadow: "0 0 0 3px var(--accent-focus-ring)",
        },
        "& input": {
          padding: compact ? "5px 10px" : "7px 11px",
          boxSizing: "border-box",
          height: "100%",
        },
      }}
    />
  );
});

export interface NativeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  role?: "dialog" | "alertdialog";
  size?: "sm" | "md" | "lg" | "full-on-phone";
  icon?: ReactNode;
  showClose?: boolean;
  preventOutsideClose?: boolean;
  dirty?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  className?: string;
  bodyClassName?: string;
  testId?: string;
  inPage?: boolean;
  closeLabel?: string;
}

export function NativeDialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  role = "dialog",
  size = "md",
  icon,
  showClose = true,
  preventOutsideClose = false,
  dirty = false,
  initialFocus,
  onSubmit,
  className,
  bodyClassName,
  testId,
  closeLabel = "关闭",
}: NativeDialogProps) {
  const phone = useMediaQuery("(max-width:599px)");
  const label = useId();
  const descriptionId = useId();
  const focusPanel = useCallback(
    (panel: HTMLDivElement | null) => {
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]),textarea:not([disabled]):not([tabindex="-1"]),select:not([disabled]):not([tabindex="-1"]),[contenteditable="true"]',
      );
      (
        initialFocus?.current ??
        first ??
        panel.querySelector<HTMLElement>("button:not([disabled])")
      )?.focus();
    },
    [initialFocus],
  );
  if (!isOpen) return null;
  const content = (
    <>
      <DialogTitle
        id={`${label}-heading`}
        aria-labelledby={label}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          padding: "16px 20px 12px",
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        {icon}
        <span id={label}>{title}</span>
        {showClose && (
          <IconButton
            disableRipple
            aria-label={closeLabel}
            onClick={onClose}
            size="small"
            sx={{ ml: "auto", width: 44, height: 44 }}
          >
            <CloseOutlined fontSize="small" />
          </IconButton>
        )}
      </DialogTitle>
      <DialogContent
        className={bodyClassName}
        sx={{ padding: "8px 20px 20px", minWidth: 0 }}
      >
        {description && (
          <Typography
            component="p"
            id={descriptionId}
            variant="body2"
            sx={{ mb: 1.75, color: "var(--muted)", lineHeight: 1.6 }}
          >
            {description}
          </Typography>
        )}
        {children}
      </DialogContent>
      {footer && (
        <DialogActions
          sx={{
            padding: "12px 20px",
            gap: 1,
            borderTop: "1px solid var(--line)",
            bgcolor: "var(--surface-sidebar)",
          }}
        >
          {footer}
        </DialogActions>
      )}
    </>
  );
  return (
    <MuiDialog
      transitionDuration={0}
      open={isOpen}
      onClose={(_, reason) => {
        if (reason === "backdropClick" && (preventOutsideClose || dirty)) return;
        onClose();
      }}
      fullScreen={size === "full-on-phone" && phone}
      fullWidth
      maxWidth={
        size === "lg" || size === "full-on-phone"
          ? "md"
          : size === "sm"
            ? "xs"
            : "sm"
      }
      aria-labelledby={label}
      aria-describedby={description ? descriptionId : undefined}
      slotProps={{
        paper: {
          role,
          ref: focusPanel,
          className,
          "data-testid": testId,
        } as HTMLAttributes<HTMLDivElement>,
        transition: { onEntered: () => initialFocus?.current?.focus() },
      }}
    >
      {onSubmit ? (
        <form
          onSubmit={onSubmit}
          style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          {content}
        </form>
      ) : (
        content
      )}
    </MuiDialog>
  );
}

export const NativeMenuPanel = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function NativeMenuPanel({ className = "", ...props }, ref) {
  return (
    <Paper
      {...props}
      ref={ref}
      elevation={0}
      className={`mail-menu-panel menu-pop-surface ${className}`.trim()}
      sx={{
        border: "1px solid var(--line-strong)",
        borderRadius: "10px",
        bgcolor: "var(--surface-overlay)",
        backdropFilter: "blur(var(--surface-acrylic-blur, 16px))",
        boxShadow: "var(--shadow-flyout)",
        fontSize: 13,
      }}
    />
  );
});

export function NativeFieldShell({
  controlId,
  noteId,
  label,
  hint,
  error,
  required = false,
  hideLabel = false,
  className,
  labelClassName,
  children,
}: {
  controlId: string;
  noteId: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  hideLabel?: boolean;
  className?: string;
  labelClassName?: string;
  children: ReactNode;
}) {
  return (
    <Box className={className} sx={{ display: "flex", flexDirection: "column" }}>
      <label
        htmlFor={controlId}
        className={
          hideLabel
            ? "sr-only"
            : `block text-sm font-medium text-foreground mb-1.5 ${labelClassName ?? ""}`.trim()
        }
      >
        {label}
        {required && (
          <span className="text-destructive" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <Typography
          component="p"
          id={noteId}
          role="alert"
          variant="caption"
          sx={{ mt: 0.5, color: "var(--danger)", fontWeight: 550 }}
        >
          {error}
        </Typography>
      ) : hint ? (
        <Typography
          component="p"
          id={noteId}
          variant="caption"
          sx={{ mt: 0.5, color: "var(--muted)" }}
        >
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

export function NativeSpinner({
  size = "md",
  label,
  className,
}: {
  size?: "sm" | "md";
  label?: string;
  className?: string;
}) {
  const sizeClass = size === "sm" ? "w-4 h-4" : "w-6 h-6";
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin flex-shrink-0 ${sizeClass} ${className ?? ""}`.trim()}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ color: "var(--accent-50)" }}
    >
      <circle
        cx="12"
        cy="12"
        r="9.5"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2.75"
      />
      <path
        d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NativePaneSpinner({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Box
      className={`flex flex-1 items-center justify-center p-8 h-full ${className ?? ""}`.trim()}
    >
      <NativeSpinner size="md" label={label} />
    </Box>
  );
}

export function NativeEmptyState({
  icon,
  title,
  description,
  actions,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Box
      className={`flex items-center justify-center ${compact ? "p-6" : "min-h-[18rem] p-8"} ${className ?? ""}`.trim()}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          maxWidth: 360,
        }}
      >
        {icon && (
          <Box
            aria-hidden="true"
            className="rounded-full bg-muted flex items-center justify-center mb-4"
            sx={{
              width: compact ? 48 : 56,
              height: compact ? 48 : 56,
              bgcolor: "var(--accent-10)",
              border: "1px solid var(--accent-20)",
              color: "var(--accent-50)",
            }}
          >
            {icon}
          </Box>
        )}
        <Typography
          component="h3"
          variant="subtitle1"
          sx={{ fontWeight: 650, color: "var(--ink)" }}
        >
          {title}
        </Typography>
        {description && (
          <Typography
            component="p"
            variant="body2"
            className="text-muted-foreground"
            sx={{ color: "var(--muted)", mt: 0.5, lineHeight: 1.55 }}
          >
            {description}
          </Typography>
        )}
        {actions && (
          <Box
            sx={{
              display: "flex",
              gap: 1,
              flexWrap: "wrap",
              justifyContent: "center",
              mt: 2.25,
            }}
          >
            {actions}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export const NativeToastSurface = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { toastType?: "success" | "error" | "info" | "warning" }
>(function NativeToastSurface({ toastType = "info", className = "", ...props }, ref) {
  return (
    <Paper
      {...props}
      ref={ref}
      elevation={0}
      data-toast-type={toastType}
      className={`mail-toast-surface ${className}`.trim()}
    />
  );
});

export const NativeBannerSurface = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function NativeBannerSurface({ className = "", ...props }, ref) {
  return (
    <Paper
      {...props}
      ref={ref}
      elevation={0}
      className={`mail-banner-surface ${className}`.trim()}
    />
  );
});

export const NativeSelectTrigger = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { open?: boolean }
>(function NativeSelectTrigger({ open = false, className = "", color: _color, children, ...props }, ref) {
  return (
    <MuiButton
      disableRipple
      ref={ref}
      type="button"
      variant="outlined"
      className={`mail-button ${className}`.trim()}
      {...props}
      sx={{
        width: "100%",
        minHeight: 34,
        justifyContent: "space-between",
        gap: 1,
        px: 1.5,
        py: 0.75,
        borderRadius: "8px",
        borderColor: open ? "var(--accent-50)" : "var(--line)",
        bgcolor: open ? "var(--surface-card)" : "var(--surface-inset)",
        color: "var(--ink)",
        fontSize: 13.5,
        fontWeight: 500,
        boxShadow: open ? "0 0 0 3px var(--accent-focus-ring)" : "none",
        "&:hover": {
          borderColor: "var(--line-strong)",
          bgcolor: "var(--surface-card)",
        },
      }}
    >
      <Box
        component="span"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          flex: 1,
          minWidth: 0,
          textAlign: "start",
        }}
      >
        {children}
      </Box>
      <ExpandMoreOutlined
        fontSize="small"
        aria-hidden="true"
        sx={{
          color: "var(--icon-muted)",
          flexShrink: 0,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform var(--motion-panel) var(--ease-fluent)",
        }}
      />
    </MuiButton>
  );
});

export const NativeCommandSurface = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function NativeCommandSurface({ className = "", ...props }, ref) {
  return (
    <Paper
      {...props}
      ref={ref}
      elevation={0}
      className={`mail-command-surface MuiDialog-paper ${className}`.trim()}
    />
  );
});
