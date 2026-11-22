"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Box,
  Button,
  IconButton,
  Paper,
  Popover,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckOutlined from "@mui/icons-material/CheckOutlined";
import ColorLensOutlined from "@mui/icons-material/ColorLensOutlined";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import {
  ACCENT_PRESETS,
  getAccentPreset,
  type AccentPresetId,
} from "./theme";

/**
 * Keyed content transition for tab switches and view mode changes.
 * Avoid keying active form inputs that must preserve focus across renders.
 */
export function ContentSwapTransition({
  children,
  contentKey,
}: {
  children: ReactNode;
  contentKey: string;
  initialChange?: boolean;
}) {
  return (
    <Box
      key={contentKey}
      className="content-transition"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: "inherit",
        minWidth: 0,
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Pure UI copy trigger with spring checkmark feedback.
 * Host clipboard writes stay in the application layer via `onCopy`.
 */
export function ConsoleCopyAction({
  label = "复制",
  copiedLabel = "已复制",
  onCopy,
  size = "small",
  variant = "icon",
}: {
  label?: string;
  copiedLabel?: string;
  onCopy: () => Promise<boolean> | boolean | void;
  size?: "small" | "medium";
  variant?: "icon" | "text";
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleClick() {
    try {
      const result = await onCopy();
      if (result === false) return;
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Ignore copy failures; host callback reports error when needed. */
    }
  }

  if (variant === "text") {
    return (
      <Button
        type="button"
        size="small"
        variant="text"
        onClick={() => void handleClick()}
        startIcon={
          copied ? (
            <CheckOutlined fontSize="small" className="console-copy-check" />
          ) : (
            <ContentCopyOutlined fontSize="small" />
          )
        }
        sx={{
          minHeight: 28,
          px: 1,
          color: copied ? "var(--success)" : "var(--muted)",
        }}
      >
        {copied ? copiedLabel : label}
      </Button>
    );
  }

  return (
    <Tooltip title={copied ? copiedLabel : label} placement="top">
      <IconButton
        type="button"
        size={size}
        aria-label={copied ? copiedLabel : label}
        onClick={() => void handleClick()}
        sx={{
          width: size === "small" ? 28 : 34,
          height: size === "small" ? 28 : 34,
          color: copied ? "var(--success)" : "var(--icon-muted)",
        }}
      >
        {copied ? (
          <CheckOutlined sx={{ fontSize: 15 }} className="console-copy-check" />
        ) : (
          <ContentCopyOutlined sx={{ fontSize: 15 }} />
        )}
      </IconButton>
    </Tooltip>
  );
}

/** Structured loading skeleton matching compact console geometry. */
export function ConsoleSkeleton({
  variant = "panel",
  label = "正在读取控制台…",
}: {
  variant?: "overview" | "table" | "form" | "panel";
  label?: string;
}) {
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={label}
      sx={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      {variant === "overview" && (
        <>
          <Box className="console-stats">
            {[0, 1, 2, 3].map((idx) => (
              <Paper
                key={idx}
                elevation={0}
                sx={{
                  p: 1.75,
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                  bgcolor: "var(--surface-card)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.25,
                }}
              >
                <Box className="console-skeleton-bar" sx={{ height: 12, width: "48%" }} />
                <Box className="console-skeleton-bar" sx={{ height: 26, width: "36%" }} />
                <Box className="console-skeleton-bar" sx={{ height: 10, width: "70%" }} />
              </Paper>
            ))}
          </Box>
          <Box className="console-columns">
            {[0, 1].map((idx) => (
              <Box key={idx} className="console-panel">
                <Box className="console-skeleton-bar" sx={{ height: 16, width: "38%" }} />
                <Box className="console-skeleton-bar" sx={{ height: 24, width: "54%" }} />
                <Box className="console-skeleton-bar" sx={{ height: 12, width: "80%" }} />
              </Box>
            ))}
          </Box>
        </>
      )}

      {variant === "table" && (
        <Box className="console-panel">
          <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
            <Box className="console-skeleton-bar" sx={{ height: 34, width: 240, maxWidth: "60%" }} />
            <Box className="console-skeleton-bar" sx={{ height: 28, width: 200, maxWidth: "35%" }} />
          </Box>
          {[0, 1, 2, 3].map((row) => (
            <Box
              key={row}
              sx={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
                gap: 1.5,
                alignItems: "center",
                py: 0.75,
              }}
            >
              <Box className="console-skeleton-bar" sx={{ height: 14, width: "78%" }} />
              <Box className="console-skeleton-bar" sx={{ height: 20, width: 54 }} />
              <Box className="console-skeleton-bar" sx={{ height: 14, width: 64 }} />
              <Box className="console-skeleton-bar" sx={{ height: 14, width: 88 }} />
              <Box className="console-skeleton-bar" sx={{ height: 26, width: 44 }} />
            </Box>
          ))}
        </Box>
      )}

      {variant === "form" && (
        <Box className="console-panel">
          <Box className="console-skeleton-bar" sx={{ height: 16, width: "32%" }} />
          <Box className="console-form-grid">
            {[0, 1, 2, 3].map((field) => (
              <Box key={field} className="console-skeleton-bar" sx={{ height: 38, width: "100%" }} />
            ))}
          </Box>
        </Box>
      )}

      {variant === "panel" && (
        <Box className="console-panel">
          <Box className="console-skeleton-bar" sx={{ height: 16, width: "34%" }} />
          <Box className="console-skeleton-bar" sx={{ height: 12, width: "72%" }} />
          <Box className="console-skeleton-bar" sx={{ height: 12, width: "56%" }} />
        </Box>
      )}

      <Typography
        variant="caption"
        sx={{ color: "var(--muted)", px: 0.5 }}
      >
        {label}
      </Typography>
    </Box>
  );
}

/** Compact empty state for console tables, queues, and audit lists. */
export function ConsoleEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Box
      sx={{
        py: 3.5,
        px: 2.5,
        borderRadius: "10px",
        border: "1px dashed var(--line-strong)",
        bgcolor: "var(--surface-inset)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 0.75,
      }}
    >
      {icon && (
        <Box
          aria-hidden="true"
          sx={{
            width: 38,
            height: 38,
            borderRadius: "10px",
            bgcolor: "var(--accent-10)",
            color: "var(--accent-50)",
            display: "grid",
            placeItems: "center",
            mb: 0.5,
          }}
        >
          {icon}
        </Box>
      )}
      <Typography variant="subtitle2" sx={{ color: "var(--ink)", fontWeight: 650 }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="caption" sx={{ color: "var(--muted)", maxWidth: 360 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Box>
  );
}

export interface ConsoleKeyValueItem {
  id: string;
  label: string;
  value: ReactNode;
  copyText?: string;
  onCopy?: () => Promise<boolean> | boolean | void;
  mono?: boolean;
}

/** Compact key-value readout grid for configuration metadata & resource IDs. */
export function ConsoleKeyValueGrid({
  items,
}: {
  items: readonly ConsoleKeyValueItem[];
}) {
  return (
    <dl className="console-kv-grid">
      {items.map((item) => (
        <div key={item.id} className="console-kv-item">
          <dt>{item.label}</dt>
          <dd>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              {item.mono && typeof item.value === "string" ? (
                <code>{item.value}</code>
              ) : (
                item.value
              )}
            </Box>
            {item.onCopy && (
              <ConsoleCopyAction
                label={`复制${item.label}`}
                onCopy={item.onCopy}
              />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Compact pill stepper for auth verification and initial setup workflows. */
export function ConsoleStepBar({
  steps,
  activeIndex,
  ariaLabel = "进度步骤",
}: {
  steps: readonly { label: string }[];
  activeIndex: number;
  ariaLabel?: string;
}) {
  return (
    <ol className="console-step-bar" aria-label={ariaLabel}>
      {steps.map((step, index) => {
        const state =
          index < activeIndex
            ? "done"
            : index === activeIndex
              ? "active"
              : "upcoming";
        return (
          <li
            key={step.label}
            className="console-step-item"
            data-state={state}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="console-step-badge" aria-hidden="true">
              {state === "done" ? (
                <CheckOutlined sx={{ fontSize: 13 }} />
              ) : (
                index + 1
              )}
            </span>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * KIRAKIRA 6-preset accent switcher.
 * Supports compact `popover` trigger (console sidebar footer) and `inline` palette (Webmail appearance).
 */
export function AccentPresetPicker({
  value,
  onChange,
  dark = false,
  mode = "popover",
  placement = "top",
}: {
  value: AccentPresetId;
  onChange: (next: AccentPresetId) => void;
  dark?: boolean;
  mode?: "popover" | "inline";
  placement?: "top" | "right";
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const popId = useId();
  const active = getAccentPreset(value);

  if (mode === "inline") {
    return (
      <Box
        role="radiogroup"
        aria-label="个性主题色"
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 1,
        }}
      >
        {ACCENT_PRESETS.map((preset) => {
          const selected = preset.id === active.id;
          const swatch = dark ? preset.dark.main : preset.light.main;
          return (
            <Button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              size="small"
              variant={selected ? "contained" : "outlined"}
              onClick={() => onChange(preset.id)}
              sx={{
                minHeight: 32,
                px: 1.25,
                gap: 0.75,
                borderRadius: "999px",
                borderColor: selected ? "transparent" : "var(--line-strong)",
                bgcolor: selected ? "var(--accent-10)" : "var(--surface-card)",
                color: selected ? "var(--accent-70)" : "var(--ink)",
                boxShadow: "none",
                "&:hover": {
                  bgcolor: selected ? "var(--accent-15)" : "var(--accent-hover-overlay)",
                  borderColor: "var(--accent-30)",
                  boxShadow: "none",
                },
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  bgcolor: swatch,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  boxShadow: selected ? "0 0 0 2px var(--surface-card)" : "none",
                }}
              />
              <span>{preset.label}</span>
            </Button>
          );
        })}
      </Box>
    );
  }

  return (
    <>
      <Tooltip title={`个性主题色：${active.label}`} placement={placement}>
        <IconButton
          type="button"
          size="small"
          aria-label="切换个性主题色"
          aria-controls={anchor ? popId : undefined}
          aria-haspopup="dialog"
          aria-expanded={!!anchor}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            position: "relative",
          }}
        >
          <ColorLensOutlined fontSize="small" />
          <Box
            aria-hidden="true"
            sx={{
              position: "absolute",
              right: 5,
              bottom: 5,
              width: 7,
              height: 7,
              borderRadius: "50%",
              bgcolor: "var(--accent-50)",
              border: "1.5px solid var(--surface-sidebar)",
            }}
          />
        </IconButton>
      </Tooltip>
      <Popover
        id={popId}
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{
          vertical: placement === "right" ? "bottom" : "top",
          horizontal: placement === "right" ? "right" : "center",
        }}
        transformOrigin={{
          vertical: placement === "right" ? "bottom" : "bottom",
          horizontal: placement === "right" ? "left" : "center",
        }}
        slotProps={{
          paper: {
            sx: {
              p: 1.5,
              width: 224,
              mb: placement === "top" ? 1 : 0,
              ml: placement === "right" ? 1 : 0,
            },
          },
        }}
      >
        <Typography
          variant="caption"
          sx={{
            display: "block",
            fontWeight: 700,
            color: "var(--muted)",
            mb: 1,
            px: 0.5,
          }}
        >
          个性主题色 · KIRAKIRA
        </Typography>
        <Box
          role="radiogroup"
          aria-label="选择个性主题色"
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 0.75,
          }}
        >
          {ACCENT_PRESETS.map((preset) => {
            const selected = preset.id === active.id;
            const swatch = dark ? preset.dark.main : preset.light.main;
            return (
              <Button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selected}
                size="small"
                variant="text"
                onClick={() => {
                  onChange(preset.id);
                  setAnchor(null);
                }}
                sx={{
                  justifyContent: "flex-start",
                  gap: 0.75,
                  px: 1,
                  minHeight: 32,
                  borderRadius: "8px",
                  border: "1px solid",
                  borderColor: selected ? "var(--accent-30)" : "var(--line)",
                  bgcolor: selected ? "var(--accent-10)" : "var(--surface-card)",
                  color: selected ? "var(--accent-70)" : "var(--ink)",
                }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    bgcolor: swatch,
                    display: "grid",
                    placeItems: "center",
                    color: dark ? preset.dark.contrastText : preset.light.contrastText,
                    flexShrink: 0,
                  }}
                >
                  {selected && <CheckOutlined sx={{ fontSize: 10 }} />}
                </Box>
                <Typography
                  component="span"
                  variant="caption"
                  noWrap
                  sx={{ fontWeight: selected ? 700 : 550, color: "inherit" }}
                >
                  {preset.label}
                </Typography>
              </Button>
            );
          })}
        </Box>
      </Popover>
    </>
  );
}
