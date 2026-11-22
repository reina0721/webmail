"use client";
import {
  useId,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
  type Ref,
} from "react";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import SearchOutlined from "@mui/icons-material/SearchOutlined";
import UploadFileOutlined from "@mui/icons-material/UploadFileOutlined";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import WarningAmberOutlined from "@mui/icons-material/WarningAmberOutlined";
import {
  Button,
  IconButton,
  TextField as Field,
  MenuItem,
  Menu,
  ListSubheader,
  Divider,
  Tooltip,
  Checkbox,
  FormControlLabel,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Alert,
  Typography,
  Box,
  Autocomplete,
  Slider,
} from "@mui/material";

export {
  Box,
  Stack,
  Typography,
  Paper,
  Card,
  CardContent,
  CardHeader,
  CardActions,
  Divider,
  Chip,
  Alert,
  Snackbar,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Avatar,
  LinearProgress,
  Autocomplete,
  ToggleButton,
  ToggleButtonGroup,
  Skeleton,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Pagination,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  Collapse,
  Popover,
  Badge,
  Breadcrumbs,
  AlertTitle,
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
} from "@mui/material";

export * from "./console-shell";
export * from "./primitives";
export {
  ACCENT_PRESETS,
  getAccentPreset,
  type AccentPreset,
  type AccentPresetId,
} from "./theme";

export { default as MailOutlined } from "@mui/icons-material/MailOutlined";
export { default as CalendarMonthOutlined } from "@mui/icons-material/CalendarMonthOutlined";
export { default as PeopleOutlined } from "@mui/icons-material/PeopleOutlined";
export { default as FolderOutlined } from "@mui/icons-material/FolderOutlined";
export { default as SettingsOutlined } from "@mui/icons-material/SettingsOutlined";
export { default as DashboardOutlined } from "@mui/icons-material/DashboardOutlined";
export { default as AutoAwesomeOutlined } from "@mui/icons-material/AutoAwesomeOutlined";
export { default as AddOutlined } from "@mui/icons-material/AddOutlined";
export { default as DownloadOutlined } from "@mui/icons-material/DownloadOutlined";
export { default as EditOutlined } from "@mui/icons-material/EditOutlined";
export { default as DeleteOutlined } from "@mui/icons-material/DeleteOutlined";
export { default as InsertDriveFileOutlined } from "@mui/icons-material/InsertDriveFileOutlined";
export { default as GridViewOutlined } from "@mui/icons-material/GridViewOutlined";
export { default as ViewListOutlined } from "@mui/icons-material/ViewListOutlined";
export { default as ArrowBackOutlined } from "@mui/icons-material/ArrowBackOutlined";
export { default as RestoreOutlined } from "@mui/icons-material/RestoreOutlined";
export { default as ShareOutlined } from "@mui/icons-material/ShareOutlined";
export { default as ChevronLeft } from "@mui/icons-material/ChevronLeft";
export { default as ChevronRight } from "@mui/icons-material/ChevronRight";
export { default as FormatBold } from "@mui/icons-material/FormatBold";
export { default as FormatItalic } from "@mui/icons-material/FormatItalic";
export { default as FormatListBulleted } from "@mui/icons-material/FormatListBulleted";
export { default as FormatListNumbered } from "@mui/icons-material/FormatListNumbered";
export { default as Undo } from "@mui/icons-material/Undo";
export { default as Redo } from "@mui/icons-material/Redo";
export { default as SpaceDashboardOutlined } from "@mui/icons-material/SpaceDashboardOutlined";
export { default as GroupOutlined } from "@mui/icons-material/GroupOutlined";
export { default as DnsOutlined } from "@mui/icons-material/DnsOutlined";
export { default as VerifiedUserOutlined } from "@mui/icons-material/VerifiedUserOutlined";
export { default as TuneOutlined } from "@mui/icons-material/TuneOutlined";
export { default as MonitorHeartOutlined } from "@mui/icons-material/MonitorHeartOutlined";
export { default as SystemUpdateAltOutlined } from "@mui/icons-material/SystemUpdateAltOutlined";
export { default as BuildOutlined } from "@mui/icons-material/BuildOutlined";
export { default as PublicOutlined } from "@mui/icons-material/PublicOutlined";
export { default as PaletteOutlined } from "@mui/icons-material/PaletteOutlined";
export { default as TravelExploreOutlined } from "@mui/icons-material/TravelExploreOutlined";
export { default as ShieldOutlined } from "@mui/icons-material/ShieldOutlined";
export { default as MarkEmailReadOutlined } from "@mui/icons-material/MarkEmailReadOutlined";
export { default as TaskAltOutlined } from "@mui/icons-material/TaskAltOutlined";
export { default as FactCheckOutlined } from "@mui/icons-material/FactCheckOutlined";
export { default as ForwardToInboxOutlined } from "@mui/icons-material/ForwardToInboxOutlined";
export { default as HistoryOutlined } from "@mui/icons-material/HistoryOutlined";
export { default as CheckCircleOutlined } from "@mui/icons-material/CheckCircleOutlined";
export { default as ErrorOutlineOutlined } from "@mui/icons-material/ErrorOutlineOutlined";
export { default as WarningAmberOutlined } from "@mui/icons-material/WarningAmberOutlined";
export { default as InfoOutlined } from "@mui/icons-material/InfoOutlined";
export { default as RefreshOutlined } from "@mui/icons-material/RefreshOutlined";
export { default as ContentCopyOutlined } from "@mui/icons-material/ContentCopyOutlined";
export { default as OpenInNewOutlined } from "@mui/icons-material/OpenInNewOutlined";
export { default as SaveOutlined } from "@mui/icons-material/SaveOutlined";
export { default as RestartAltOutlined } from "@mui/icons-material/RestartAltOutlined";
export { default as DarkModeOutlined } from "@mui/icons-material/DarkModeOutlined";
export { default as LightModeOutlined } from "@mui/icons-material/LightModeOutlined";
export { default as ExpandMoreOutlined } from "@mui/icons-material/ExpandMoreOutlined";
export { default as CloseOutlined } from "@mui/icons-material/CloseOutlined";
export { default as CheckOutlined } from "@mui/icons-material/CheckOutlined";
export { default as SearchOutlined } from "@mui/icons-material/SearchOutlined";
export { default as ColorLensOutlined } from "@mui/icons-material/ColorLensOutlined";
export { default as UploadFileOutlined } from "@mui/icons-material/UploadFileOutlined";

type ActionProps = {
  children: ReactNode;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  onPress?: () => void;
};

export function Action({
  children,
  leadingIcon,
  trailingIcon,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  onPress,
  ...rest
}: ActionProps) {
  return (
    <Button
      {...rest}
      variant={
        variant === "quiet"
          ? "text"
          : variant === "secondary"
            ? "outlined"
            : "contained"
      }
      color={variant === "danger" ? "error" : "primary"}
      size={size === "sm" ? "small" : size === "lg" ? "large" : "medium"}
      disabled={disabled || loading}
      onClick={onPress}
      startIcon={
        loading ? <CircularProgress size={15} color="inherit" /> : leadingIcon
      }
      endIcon={trailingIcon}
    >
      {children}
    </Button>
  );
}

export function IconAction({
  label,
  children,
  onPress,
  disabled,
  loading,
  active,
  controls,
  expanded,
  tooltip,
  tooltipPlacement = "bottom",
}: {
  label: string;
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  active?: boolean;
  controls?: string;
  expanded?: boolean;
  variant?: string;
  size?: string;
  tone?: string;
  tooltip?: boolean | string;
  tooltipPlacement?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip
      title={typeof tooltip === "string" ? tooltip : tooltip ? label : ""}
      placement={tooltipPlacement}
    >
      <span>
        <IconButton
          aria-label={label}
          aria-controls={controls}
          aria-expanded={expanded}
          aria-pressed={active}
          disabled={disabled || loading}
          color={active ? "primary" : "default"}
          onClick={onPress}
        >
          {loading ? <CircularProgress size={16} /> : children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

type FieldProps = Omit<
  ComponentProps<typeof Field>,
  "error" | "ref" | "size"
> & {
  hint?: string;
  error?: string;
  purpose?: string;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({ hint, error, purpose, ref, ...props }: FieldProps) {
  return (
    <Field
      fullWidth
      size="small"
      {...props}
      inputRef={ref}
      type={purpose === "email" ? "email" : props.type}
      error={!!error}
      helperText={error || hint}
    />
  );
}

export function TextAreaField(props: FieldProps) {
  return <TextField multiline minRows={props.rows ?? 4} {...props} />;
}

export function PasswordField({
  showLabel = "显示密码",
  hideLabel = "隐藏密码",
  purpose,
  ...props
}: FieldProps & { showLabel?: string; hideLabel?: string }) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...props}
      type={show ? "text" : "password"}
      autoComplete={purpose === "new" ? "new-password" : "current-password"}
      slotProps={{
        input: {
          endAdornment: (
            <IconButton
              size="small"
              aria-label={show ? hideLabel : showLabel}
              onClick={() => setShow(!show)}
            >
              {show ? (
                <VisibilityOff fontSize="small" />
              ) : (
                <Visibility fontSize="small" />
              )}
            </IconButton>
          ),
        },
      }}
    />
  );
}

export function SelectField({
  label,
  value,
  options,
  onValueChange,
  hint,
  error,
  disabled,
  defaultValue,
  presentation,
}: {
  label: string;
  value?: string | null;
  options: readonly {
    value: string;
    label: string;
    disabled?: boolean;
    description?: string;
  }[];
  onValueChange?: (v: string) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
  defaultValue?: string;
  presentation?: string;
  name?: string;
  placeholder?: string;
  defaultOpen?: boolean;
}) {
  return (
    <Field
      className="mail-field"
      select
      fullWidth={presentation !== "toolbar"}
      label={label}
      value={
        options.some((o) => o.value === (value ?? defaultValue))
          ? (value ?? defaultValue)
          : ""
      }
      onChange={(e) => onValueChange?.(e.target.value)}
      size="small"
      disabled={disabled}
      error={!!error}
      helperText={error || hint}
    >
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </MenuItem>
      ))}
    </Field>
  );
}

export function CheckboxField({
  label,
  checked,
  indeterminate,
  disabled,
  onCheckedChange,
  labelVisibility,
  description,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onCheckedChange?: (v: boolean) => void;
  labelVisibility?: string;
  description?: string;
}) {
  const control = (
    <Checkbox
      size="small"
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onChange={(_, v) => onCheckedChange?.(v)}
      slotProps={{ input: { "aria-label": label } }}
    />
  );
  return labelVisibility === "screen-reader" ? (
    control
  ) : (
    <FormControlLabel
      sx={{ m: 0, alignItems: "flex-start", gap: 0.5 }}
      control={control}
      label={
        <Box component="span" sx={{ pt: 0.35, display: "block", fontSize: 13 }}>
          {label}
          {description && (
            <Typography
              component="small"
              sx={{ display: "block", fontSize: 11.5 }}
              color="text.secondary"
            >
              {description}
            </Typography>
          )}
        </Box>
      }
    />
  );
}

export function SwitchField({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (v: boolean) => void;
  presentation?: string;
}) {
  return (
    <FormControlLabel
      sx={{
        m: 0,
        py: 0.75,
        px: 1.25,
        borderRadius: "10px",
        border: "1px solid var(--line)",
        bgcolor: "var(--surface-inset)",
        width: "100%",
        justifyContent: "space-between",
        gap: 1.5,
      }}
      labelPlacement="start"
      control={
        <Switch
          checked={checked}
          disabled={disabled}
          onChange={(_, v) => onCheckedChange(v)}
        />
      }
      label={
        <Box component="span" sx={{ display: "block", minWidth: 0 }}>
          <Typography component="span" sx={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
            {label}
          </Typography>
          <Typography
            component="small"
            sx={{ display: "block", fontSize: 11.5, mt: 0.2 }}
            color="text.secondary"
          >
            {description}
          </Typography>
        </Box>
      }
    />
  );
}

export function FileField({
  label,
  hint,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  hint?: string;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const id = useId();
  return (
    <Box>
      <Button
        component="label"
        htmlFor={id}
        variant="outlined"
        size="small"
        disabled={disabled}
        startIcon={<UploadFileOutlined fontSize="small" />}
      >
        {label}
        <input
          id={id}
          hidden
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </Button>
      {hint && (
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 0.5 }}
          color="text.secondary"
        >
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <Box sx={{ px: 0.5 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 0.25,
        }}
      >
        <Typography
          component="label"
          htmlFor={id}
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: 12.5 }}
        >
          {label}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 650,
            fontSize: 12.5,
            fontVariantNumeric: "tabular-nums",
            color: "var(--accent-70)",
            bgcolor: "var(--accent-10)",
            px: 0.85,
            py: 0.15,
            borderRadius: "6px",
          }}
        >
          {value}
          {unit}
        </Typography>
      </Box>
      <Slider
        id={id}
        size="small"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        onChange={(_, v) => {
          if (typeof v === "number") onChange(v);
        }}
      />
      {hint && (
        <Typography
          variant="caption"
          sx={{ display: "block", fontSize: 11.5 }}
          color="text.secondary"
        >
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export function SearchBox({
  label,
  placeholder,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  value?: string;
  onValueChange?: (v: string) => void;
  disabled?: boolean;
}) {
  const current = value ?? "";
  return (
    <Field
      fullWidth
      size="small"
      type="search"
      placeholder={placeholder}
      value={current}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
      slotProps={{
        htmlInput: { "aria-label": label },
        input: {
          startAdornment: (
            <SearchOutlined
              fontSize="small"
              aria-hidden="true"
              sx={{ color: "var(--icon-muted)", mr: 0.75, fontSize: 17 }}
            />
          ),
          endAdornment: current ? (
            <IconButton
              size="small"
              aria-label={`清除${label}`}
              onClick={() => onValueChange?.("")}
              sx={{ width: 24, height: 24 }}
            >
              <CloseOutlined sx={{ fontSize: 14 }} />
            </IconButton>
          ) : undefined,
        },
      }}
    />
  );
}

type MenuAction = {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: string;
};

type MenuChoice = MenuAction & {
  value: string;
  selectedId: string;
  options: readonly MenuAction[];
};

export function MenuButton({
  label,
  ariaLabel,
  items,
  groups,
  header,
  onAction,
  variant,
}: {
  label: ReactNode;
  ariaLabel: string;
  items?: readonly MenuAction[];
  groups?: readonly {
    id: string;
    label: string;
    items: readonly (MenuAction | MenuChoice)[];
  }[];
  header?: ReactNode;
  onAction: (id: string) => void;
  variant?: string;
  submenuLayout?: string;
  defaultOpen?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  const action = (item: MenuAction) => (
    <MenuItem
      key={item.id}
      disabled={item.disabled}
      onClick={() => {
        setAnchor(null);
        onAction(item.id);
      }}
    >
      {item.icon}
      <Box component="span" sx={{ ml: item.icon ? 1 : 0 }}>
        {item.label}
        {item.description && (
          <Typography variant="caption" sx={{ display: "block" }}>
            {item.description}
          </Typography>
        )}
      </Box>
    </MenuItem>
  );
  return (
    <>
      <Button
        aria-label={ariaLabel}
        aria-controls={anchor ? id : undefined}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        variant={variant === "quiet" ? "text" : "outlined"}
        size="small"
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        {label}
      </Button>
      <Menu
        id={id}
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
      >
        {header && <ListSubheader>{header}</ListSubheader>}
        {items?.map(action)}
        {groups?.flatMap((g, i) => [
          ...(i ? [<Divider key={g.id + "-divider"} />] : []),
          ...(g.label
            ? [<ListSubheader key={g.id + "-label"}>{g.label}</ListSubheader>]
            : []),
          ...g.items.flatMap((item) =>
            "options" in item
              ? [
                  <ListSubheader key={item.id + "-label"}>
                    {item.label}
                  </ListSubheader>,
                  ...item.options.map(action),
                ]
              : [action(item)],
          ),
        ])}
      </Menu>
    </>
  );
}

type OverlayProps = {
  triggerLabel: string;
  title: string;
  description: string;
  children?: ReactNode;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
};

export function DrawerSurface({
  triggerLabel,
  title,
  description,
  children,
  footer,
  badge,
  defaultOpen = false,
  isOpen,
  onOpenChange,
  closeLabel,
  placement = "right",
}: OverlayProps & {
  closeLabel: string;
  placement?: "left" | "right";
  composition?: string;
  footer?: ReactNode;
  badge?: ReactNode;
}) {
  const [internal, setInternal] = useState(defaultOpen);
  const open = isOpen ?? internal;
  const set = (v: boolean) => {
    setInternal(v);
    onOpenChange?.(v);
  };
  const titleId = useId();
  return (
    <>
      {isOpen === undefined && (
        <Action variant="secondary" onPress={() => set(true)}>
          {triggerLabel}
        </Action>
      )}
      <Drawer anchor={placement} open={open} onClose={() => set(false)}>
        <Box
          sx={{
            width: "min(440px, 92vw)",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            bgcolor: "var(--surface-card)",
          }}
          role="dialog"
          aria-labelledby={titleId}
        >
          <Box
            sx={{
              px: 2.5,
              py: 2,
              borderBottom: "1px solid var(--line)",
              bgcolor: "var(--surface-sidebar)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 1.5,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography id={titleId} variant="h6" sx={{ fontSize: 16 }}>
                  {title}
                </Typography>
                {badge}
              </Box>
              {description && (
                <Typography
                  color="text.secondary"
                  variant="body2"
                  noWrap
                  sx={{ mt: 0.35, fontSize: 12.5 }}
                >
                  {description}
                </Typography>
              )}
            </Box>
            <IconButton
              size="small"
              aria-label={closeLabel}
              onClick={() => set(false)}
            >
              <CloseOutlined fontSize="small" />
            </IconButton>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2.5 }}>
            {children}
          </Box>
          {footer && (
            <Box
              sx={{
                px: 2.5,
                py: 1.5,
                borderTop: "1px solid var(--line)",
                bgcolor: "var(--surface-sidebar)",
                display: "flex",
                justifyContent: "flex-end",
                gap: 1,
              }}
            >
              {footer}
            </Box>
          )}
        </Box>
      </Drawer>
    </>
  );
}

export function ConfirmDialog({
  triggerLabel,
  title,
  description,
  impact,
  cancelLabel,
  confirmLabel,
  failureMessage,
  onConfirm,
  confirmDisabled,
  tone = "primary",
  defaultOpen = false,
  isOpen,
  onOpenChange,
  children,
}: OverlayProps & {
  impact?: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  failureMessage?: string;
  onConfirm: () => void | Promise<void>;
  confirmDisabled?: boolean;
  tone?: string;
}) {
  const [internal, setInternal] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const open = isOpen ?? internal;
  const set = (v: boolean) => {
    if (!lock.current) {
      setInternal(v);
      onOpenChange?.(v);
    }
  };
  const id = useId();
  const isDanger = tone === "danger";
  return (
    <>
      {isOpen === undefined && (
        <Action
          variant={isDanger ? "danger" : "secondary"}
          onPress={() => set(true)}
        >
          {triggerLabel}
        </Action>
      )}
      <Dialog
        open={open}
        onClose={() => set(false)}
        aria-labelledby={id}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle
          id={id}
          sx={{ display: "flex", alignItems: "center", gap: 1.25 }}
        >
          <Box
            aria-hidden="true"
            sx={{
              width: 30,
              height: 30,
              borderRadius: "8px",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              bgcolor: isDanger ? "var(--danger-soft)" : "var(--accent-10)",
              color: isDanger ? "var(--danger)" : "var(--accent-50)",
            }}
          >
            {isDanger ? (
              <WarningAmberOutlined sx={{ fontSize: 18 }} />
            ) : (
              <InfoOutlined sx={{ fontSize: 18 }} />
            )}
          </Box>
          <span>{title}</span>
        </DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            sx={{ mb: impact || children || error ? 1.5 : 0, color: "var(--muted)", lineHeight: 1.6 }}
          >
            {description}
          </Typography>
          {impact}
          {children}
          {error && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {failureMessage ?? "操作失败，请重试"}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" disabled={busy} onClick={() => set(false)}>
            {cancelLabel}
          </Button>
          <Button
            size="small"
            disabled={busy || confirmDisabled}
            variant="contained"
            color={isDanger ? "error" : "primary"}
            onClick={async () => {
              if (lock.current) return;
              lock.current = true;
              setBusy(true);
              setError(false);
              try {
                await onConfirm();
                lock.current = false;
                set(false);
              } catch {
                setError(true);
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            {busy ? "处理中…" : confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export const DialogSurface = ConfirmDialog;

export function DisclosurePanel({
  title,
  description,
  children,
  defaultExpanded,
  disabled,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  disabled?: boolean;
}) {
  return (
    <Accordion defaultExpanded={defaultExpanded} disabled={disabled}>
      <AccordionSummary expandIcon={<ExpandMoreOutlined fontSize="small" />}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
            {title}
          </Typography>
          {description && (
            <Typography color="text.secondary" variant="caption">
              {description}
            </Typography>
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}

// Recipient entry keeps free-form mail addresses and address-book suggestions together.
export function RecipientField({
  label,
  value,
  options,
  disabled,
  onValueChange,
}: {
  label: string;
  value: string[];
  options: string[];
  disabled?: boolean;
  onValueChange: (v: string[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={value}
      disabled={disabled}
      onChange={(_, v) =>
        onValueChange(
          v.flatMap((s) =>
            s
              .split(/[,;，；]/)
              .map((entry) => entry.trim())
              .filter(Boolean),
          ),
        )
      }
      renderInput={(params) => <Field {...params} label={label} size="small" />}
    />
  );
}
