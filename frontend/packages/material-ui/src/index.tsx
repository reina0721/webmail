"use client";
import {
  useId,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
  type Ref,
} from "react";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
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
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
} from "@mui/material";
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
        loading ? <CircularProgress size={16} color="inherit" /> : leadingIcon
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
          {loading ? <CircularProgress size={18} /> : children}
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
      control={control}
      label={
        <span>
          {label}
          {description && (
            <Typography
              component="small"
              sx={{ display: "block" }}
              color="text.secondary"
            >
              {description}
            </Typography>
          )}
        </span>
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
      control={
        <Switch
          checked={checked}
          disabled={disabled}
          onChange={(_, v) => onCheckedChange(v)}
        />
      }
      label={
        <span>
          {label}
          <Typography
            component="small"
            sx={{ display: "block" }}
            color="text.secondary"
          >
            {description}
          </Typography>
        </span>
      }
    />
  );
}
export function FileField({
  label,
  hint,
  disabled,
  onFile,
}: {
  label: string;
  hint?: string;
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
        disabled={disabled}
      >
        {label}
        <input
          id={id}
          hidden
          type="file"
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
          sx={{ display: "block" }}
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
  return (
    <Field
      fullWidth
      size="small"
      type="search"
      placeholder={placeholder}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
      slotProps={{ htmlInput: { "aria-label": label } }}
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
  defaultOpen = false,
  isOpen,
  onOpenChange,
  closeLabel,
  placement = "right",
}: OverlayProps & {
  closeLabel: string;
  placement?: "left" | "right";
  composition?: string;
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
          sx={{ width: "min(480px, 92vw)", p: 3 }}
          role="dialog"
          aria-labelledby={titleId}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Typography id={titleId} variant="h6">
              {title}
            </Typography>
            <IconButton aria-label={closeLabel} onClick={() => set(false)}>
              ×
            </IconButton>
          </Box>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            {description}
          </Typography>
          {children}
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
  const [internal, setInternal] = useState(defaultOpen),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const lock = useRef(false);
  const open = isOpen ?? internal;
  const set = (v: boolean) => {
    if (!lock.current) {
      setInternal(v);
      onOpenChange?.(v);
    }
  };
  const id = useId();
  return (
    <>
      {isOpen === undefined && (
        <Action
          variant={tone === "danger" ? "danger" : "secondary"}
          onPress={() => set(true)}
        >
          {triggerLabel}
        </Action>
      )}
      <Dialog
        open={open}
        onClose={() => set(false)}
        aria-labelledby={id}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id={id}>{title}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>{description}</Typography>
          {impact}
          {children}
          {error && (
            <Alert severity="error">
              {failureMessage ?? "操作失败，请重试"}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => set(false)}>
            {cancelLabel}
          </Button>
          <Button
            disabled={busy || confirmDisabled}
            variant="contained"
            color={tone === "danger" ? "error" : "primary"}
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
      <AccordionSummary expandIcon={<span>⌄</span>}>
        <span>
          {title}
          {description && (
            <Typography color="text.secondary" variant="body2">
              {description}
            </Typography>
          )}
        </span>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}
export function ContentSwapTransition({
  children,
}: {
  children: ReactNode;
  contentKey: string;
  initialChange?: boolean;
}) {
  return <div className="content-transition">{children}</div>;
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
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        )
      }
      renderInput={(params) => <Field {...params} label={label} size="small" />}
    />
  );
}
