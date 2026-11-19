"use client";
import {
  useEffect,
  useId,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Popover,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import MenuOpenOutlined from "@mui/icons-material/MenuOpenOutlined";
import MenuOutlined from "@mui/icons-material/MenuOutlined";
import RestartAltOutlined from "@mui/icons-material/RestartAltOutlined";
import SaveOutlined from "@mui/icons-material/SaveOutlined";

export type ConsoleTone =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "info";

export type ConsoleNavChild = {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  badge?: string | number;
  active?: boolean;
};

export type ConsoleNavItem = {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  badge?: string | number;
  badgeTone?: ConsoleTone;
  active?: boolean;
  children?: readonly ConsoleNavChild[];
};

export type ConsoleNavGroup = {
  id: string;
  label: string;
  items: readonly ConsoleNavItem[];
};

export type ConsoleBreadcrumb = {
  label: string;
  href?: string;
};

export type ConsoleRenderLink = (props: {
  href: string;
  className?: string;
  ariaCurrent?: "page";
  ariaLabel?: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  children: ReactNode;
}) => ReactNode;

const defaultRenderLink: ConsoleRenderLink = ({
  href,
  className,
  ariaCurrent,
  ariaLabel,
  onClick,
  children,
}) => (
  <a
    href={href}
    className={className}
    aria-current={ariaCurrent}
    aria-label={ariaLabel}
    onClick={onClick}
  >
    {children}
  </a>
);

function toneStyles(tone: ConsoleTone = "default") {
  switch (tone) {
    case "primary":
      return {
        bg: "var(--accent-10)",
        fg: "var(--accent-70)",
        border: "var(--accent-30)",
      };
    case "success":
      return {
        bg: "var(--success-soft)",
        fg: "var(--success)",
        border: "color-mix(in oklab, var(--success), transparent 72%)",
      };
    case "warning":
      return {
        bg: "var(--warning-soft)",
        fg: "var(--warning)",
        border: "color-mix(in oklab, var(--warning), transparent 72%)",
      };
    case "error":
      return {
        bg: "var(--danger-soft)",
        fg: "var(--danger)",
        border: "color-mix(in oklab, var(--danger), transparent 72%)",
      };
    case "info":
      return {
        bg: "var(--info-soft)",
        fg: "var(--info)",
        border: "color-mix(in oklab, var(--info), transparent 72%)",
      };
    default:
      return {
        bg: "var(--surface-inset)",
        fg: "var(--muted)",
        border: "var(--line)",
      };
  }
}

export function ConsoleStatusChip({
  label,
  tone = "default",
  size = "small",
}: {
  label: string;
  tone?: ConsoleTone;
  size?: "small" | "medium";
}) {
  const s = toneStyles(tone);
  return (
    <Chip
      size={size}
      label={label}
      sx={{
        bgcolor: s.bg,
        color: s.fg,
        border: "1px solid",
        borderColor: s.border,
        height: size === "small" ? 24 : 28,
        fontSize: size === "small" ? 12 : 13,
      }}
    />
  );
}

export function ConsoleShell({
  brand,
  brandHref = "/",
  logoUrl,
  eyebrow = "管理控制台",
  groups,
  pageTitle,
  pageSubtitle,
  breadcrumbs,
  headerActions,
  collapsed,
  onToggleCollapsed,
  expandedItems,
  onToggleExpandedItem,
  operatorEmail,
  dark = false,
  onToggleDark,
  backHref = "/",
  backLabel = "返回邮箱",
  versionText,
  renderLink = defaultRenderLink,
  children,
}: {
  brand: string;
  brandHref?: string;
  logoUrl?: string;
  eyebrow?: string;
  groups: readonly ConsoleNavGroup[];
  pageTitle?: string;
  pageSubtitle?: string;
  breadcrumbs?: readonly ConsoleBreadcrumb[];
  headerActions?: ReactNode;
  collapsed?: boolean | null;
  onToggleCollapsed?: (nextCollapsed: boolean) => void;
  expandedItems?: Record<string, boolean>;
  onToggleExpandedItem?: (itemId: string) => void;
  operatorEmail?: string;
  dark?: boolean;
  onToggleDark?: () => void;
  backHref?: string;
  backLabel?: string;
  versionText?: string;
  renderLink?: ConsoleRenderLink;
  children: ReactNode;
}) {
  const isMobile = useMediaQuery("(max-width: 899.95px)");
  const isMedium = useMediaQuery(
    "(min-width: 900px) and (max-width: 1199.95px)",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [flyout, setFlyout] = useState<{
    anchor: HTMLElement;
    item: ConsoleNavItem;
  } | null>(null);
  const [localExpanded, setLocalExpanded] = useState<Record<string, boolean>>(
    {},
  );
  const [localCollapsed, setLocalCollapsed] = useState<boolean | null>(null);

  const effectiveCollapsed = isMobile
    ? false
    : (collapsed ?? localCollapsed ?? isMedium);
  const expandedMap = expandedItems ?? localExpanded;

  const toggleItem = (id: string) => {
    if (onToggleExpandedItem) onToggleExpandedItem(id);
    else setLocalExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleCollapse = () => {
    const next = !effectiveCollapsed;
    if (onToggleCollapsed) onToggleCollapsed(next);
    else setLocalCollapsed(next);
    setFlyout(null);
  };

  useEffect(() => {
    setMobileOpen(false);
    setFlyout(null);
  }, [pageTitle]);

  const drawerWidth = effectiveCollapsed ? 74 : 268;
  const flyoutId = useId();

  const renderNavContent = (mini: boolean, closeDrawer?: () => void) => (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        bgcolor: "var(--surface-sidebar)",
        color: "var(--ink)",
      }}
    >
      {/* Brand header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: mini ? "center" : "space-between",
          gap: 1,
          px: mini ? 1 : 2,
          pt: 2,
          pb: 1.5,
        }}
      >
        {renderLink({
          href: brandHref,
          ariaLabel: brand,
          onClick: closeDrawer,
          className: "console-brand-link",
          children: (
            <Box
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 1.25,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: "10px",
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "var(--accent-10)",
                  border: "1px solid var(--accent-20)",
                  color: "var(--accent-50)",
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt=""
                    style={{ width: 22, height: 22, objectFit: "contain" }}
                  />
                ) : (
                  <Typography
                    component="span"
                    sx={{ fontWeight: 800, fontSize: 16 }}
                  >
                    ✦
                  </Typography>
                )}
              </Box>
              {!mini && (
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="subtitle1"
                    noWrap
                    sx={{
                      fontWeight: 750,
                      letterSpacing: "-0.02em",
                      lineHeight: 1.2,
                      color: "var(--ink)",
                    }}
                  >
                    {brand}
                  </Typography>
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{
                      display: "block",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      color: "var(--muted)",
                      fontWeight: 600,
                    }}
                  >
                    {eyebrow}
                  </Typography>
                </Box>
              )}
            </Box>
          ),
        })}
        {!mini && isMobile && closeDrawer && (
          <IconButton
            size="small"
            aria-label="关闭导航菜单"
            onClick={closeDrawer}
          >
            <CloseOutlined fontSize="small" />
          </IconButton>
        )}
        {!mini && !isMobile && (
          <Tooltip title="折叠为迷你导航" placement="right">
            <IconButton
              size="small"
              aria-label="折叠侧边栏"
              onClick={handleToggleCollapse}
            >
              <MenuOpenOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {mini && !isMobile && (
        <Box sx={{ display: "flex", justifyContent: "center", pb: 1 }}>
          <Tooltip title="展开侧边栏" placement="right">
            <IconButton
              size="small"
              aria-label="展开侧边栏"
              onClick={handleToggleCollapse}
            >
              <ChevronRight fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Divider sx={{ mx: mini ? 1.5 : 2, mb: 1 }} />

      {/* Navigation groups */}
      <Box
        component="nav"
        aria-label="控制台"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          px: mini ? 1 : 1.5,
          py: 0.5,
        }}
      >
        {groups.map((group, groupIndex) => (
          <Box key={group.id} sx={{ mb: 1.75 }}>
            {!mini ? (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  px: 1.5,
                  py: 0.75,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: "var(--muted)",
                }}
              >
                {group.label}
              </Typography>
            ) : (
              groupIndex > 0 && <Divider sx={{ my: 1, mx: 1 }} />
            )}

            <List disablePadding dense>
              {group.items.map((item) => {
                const hasChildren = !!item.children?.length;
                const childActive = !!item.children?.some((c) => c.active);
                const isSelected = !!item.active || childActive;
                const isExpanded =
                  expandedMap[item.id] ?? (isSelected && hasChildren);

                if (mini) {
                  const miniButton = (
                    <ListItemButton
                      selected={isSelected}
                      aria-label={item.label}
                      aria-current={item.active && !childActive ? "page" : undefined}
                      aria-haspopup={hasChildren ? "menu" : undefined}
                      aria-expanded={
                        hasChildren ? flyout?.item.id === item.id : undefined
                      }
                      onClick={(e) => {
                        if (hasChildren) {
                          e.preventDefault();
                          setFlyout((prev) =>
                            prev?.item.id === item.id
                              ? null
                              : { anchor: e.currentTarget, item },
                          );
                        }
                      }}
                      sx={{
                        justifyContent: "center",
                        px: 1,
                        py: 1.15,
                        position: "relative",
                      }}
                    >
                      {isSelected && (
                        <Box
                          aria-hidden="true"
                          className="console-nav-indicator"
                        />
                      )}
                      <ListItemIcon
                        sx={{
                          minWidth: 0,
                          justifyContent: "center",
                          color: isSelected
                            ? "var(--accent-50)"
                            : "var(--icon-muted)",
                        }}
                      >
                        <Badge
                          badgeContent={item.badge}
                          color={
                            item.badgeTone === "error"
                              ? "error"
                              : item.badgeTone === "warning"
                                ? "warning"
                                : "primary"
                          }
                          invisible={item.badge === undefined || item.badge === 0}
                        >
                          {item.icon}
                        </Badge>
                      </ListItemIcon>
                    </ListItemButton>
                  );

                  return (
                    <Box key={item.id}>
                      <Tooltip
                        title={
                          hasChildren
                            ? `${item.label}（点击展开子菜单）`
                            : item.label
                        }
                        placement="right"
                      >
                        {hasChildren ? (
                          miniButton
                        ) : (
                          <span>
                            {renderLink({
                              href: item.href,
                              ariaCurrent: item.active ? "page" : undefined,
                              className: "console-nav-anchor",
                              children: miniButton,
                            })}
                          </span>
                        )}
                      </Tooltip>
                    </Box>
                  );
                }

                return (
                  <Box key={item.id}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                      }}
                    >
                      {renderLink({
                        href: item.href,
                        ariaCurrent:
                          item.active && !childActive ? "page" : undefined,
                        onClick: closeDrawer,
                        className: "console-nav-anchor console-nav-anchor-grow",
                        children: (
                          <ListItemButton
                            selected={item.active && !childActive}
                            sx={{
                              position: "relative",
                              pr: hasChildren ? 1 : 1.5,
                              bgcolor:
                                childActive && !item.active
                                  ? "var(--accent-5)"
                                  : undefined,
                            }}
                          >
                            {isSelected && (
                              <Box
                                aria-hidden="true"
                                className="console-nav-indicator"
                              />
                            )}
                            <ListItemIcon
                              sx={{
                                minWidth: 34,
                                color: isSelected
                                  ? "var(--accent-50)"
                                  : "var(--icon-muted)",
                              }}
                            >
                              {item.icon}
                            </ListItemIcon>
                            <ListItemText
                              primary={item.label}
                              slotProps={{
                                primary: {
                                  noWrap: true,
                                  sx: {
                                    fontSize: 13.5,
                                    fontWeight: isSelected ? 650 : 500,
                                  },
                                },
                              }}
                            />
                            {item.badge !== undefined && item.badge !== 0 && (
                              <Chip
                                size="small"
                                label={item.badge}
                                sx={{
                                  height: 20,
                                  fontSize: 11,
                                  ml: 0.5,
                                  bgcolor: toneStyles(item.badgeTone ?? "primary")
                                    .bg,
                                  color: toneStyles(item.badgeTone ?? "primary")
                                    .fg,
                                }}
                              />
                            )}
                          </ListItemButton>
                        ),
                      })}
                      {hasChildren && (
                        <IconButton
                          size="small"
                          aria-label={`${isExpanded ? "收起" : "展开"}${item.label}子菜单`}
                          aria-expanded={isExpanded}
                          onClick={() => toggleItem(item.id)}
                          sx={{
                            flexShrink: 0,
                            transform: isExpanded
                              ? "rotate(180deg)"
                              : "rotate(0deg)",
                            transition: "transform 160ms ease",
                          }}
                        >
                          <ExpandMoreOutlined fontSize="small" />
                        </IconButton>
                      )}
                    </Box>

                    {hasChildren && (
                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                        <List
                          disablePadding
                          dense
                          sx={{
                            pl: 2.5,
                            ml: 1.75,
                            my: 0.25,
                            borderLeft: "1px solid var(--line)",
                          }}
                        >
                          {item.children!.map((sub) => (
                            <Box key={sub.id}>
                              {renderLink({
                                href: sub.href,
                                ariaCurrent: sub.active ? "page" : undefined,
                                onClick: closeDrawer,
                                className: "console-nav-anchor",
                                children: (
                                  <ListItemButton
                                    selected={!!sub.active}
                                    sx={{
                                      py: 0.7,
                                      px: 1.25,
                                      position: "relative",
                                    }}
                                  >
                                    {sub.active && (
                                      <Box
                                        aria-hidden="true"
                                        className="console-nav-indicator"
                                      />
                                    )}
                                    {sub.icon && (
                                      <ListItemIcon
                                        sx={{
                                          minWidth: 28,
                                          color: sub.active
                                            ? "var(--accent-50)"
                                            : "var(--icon-muted)",
                                        }}
                                      >
                                        {sub.icon}
                                      </ListItemIcon>
                                    )}
                                    <ListItemText
                                      primary={sub.label}
                                      slotProps={{
                                        primary: {
                                          noWrap: true,
                                          sx: {
                                            fontSize: 13,
                                            fontWeight: sub.active ? 650 : 480,
                                          },
                                        },
                                      }}
                                    />
                                  </ListItemButton>
                                ),
                              })}
                            </Box>
                          ))}
                        </List>
                      </Collapse>
                    )}
                  </Box>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      {/* Footer */}
      <Divider sx={{ mx: mini ? 1.5 : 2 }} />
      <Box
        component="footer"
        sx={{
          p: mini ? 1 : 1.75,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {!mini && operatorEmail && (
          <Box
            sx={{
              px: 1.25,
              py: 0.75,
              borderRadius: "10px",
              bgcolor: "var(--surface-inset)",
              border: "1px solid var(--line)",
            }}
          >
            <Typography
              variant="caption"
              sx={{ display: "block", color: "var(--muted)", fontSize: 10.5 }}
            >
              当前管理员
            </Typography>
            <Typography
              variant="caption"
              noWrap
              sx={{
                display: "block",
                fontWeight: 600,
                color: "var(--ink)",
                fontSize: 12,
              }}
            >
              {operatorEmail}
            </Typography>
          </Box>
        )}

        <Box
          sx={{
            display: "flex",
            flexDirection: mini ? "column" : "row",
            alignItems: "center",
            justifyContent: mini ? "center" : "space-between",
            gap: 0.75,
          }}
        >
          <Tooltip
            title={backLabel}
            placement={mini ? "right" : "top"}
          >
            <span>
              {renderLink({
                href: backHref,
                ariaLabel: backLabel,
                onClick: closeDrawer,
                className: "console-back-link",
                children: mini ? (
                  <IconButton size="small" aria-label={backLabel} tabIndex={-1}>
                    <ChevronLeft fontSize="small" />
                  </IconButton>
                ) : (
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<ChevronLeft fontSize="small" />}
                    sx={{ color: "var(--muted)", px: 1 }}
                  >
                    {backLabel}
                  </Button>
                ),
              })}
            </span>
          </Tooltip>

          {onToggleDark && (
            <Tooltip
              title={dark ? "切换浅色主题" : "切换深色主题"}
              placement={mini ? "right" : "top"}
            >
              <IconButton
                size="small"
                aria-label={dark ? "切换浅色主题" : "切换深色主题"}
                onClick={onToggleDark}
              >
                {dark ? (
                  <LightModeOutlined fontSize="small" />
                ) : (
                  <DarkModeOutlined fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {!mini && versionText && (
          <Typography
            variant="caption"
            noWrap
            sx={{ px: 1, color: "var(--muted)", fontSize: 11 }}
          >
            {versionText}
          </Typography>
        )}
      </Box>
    </Box>
  );

  return (
    <Box
      className="console-shell-root"
      sx={{
        display: "flex",
        height: "100dvh",
        minWidth: 0,
        bgcolor: "var(--surface-canvas)",
        color: "var(--ink)",
      }}
    >
      {/* Desktop persistent sidebar (expanded or mini) */}
      {!isMobile && (
        <Drawer
          variant="permanent"
          open
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            transition: "width 180ms cubic-bezier(.2,.8,.2,1)",
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
              borderRight: "1px solid var(--line)",
              bgcolor: "var(--surface-sidebar)",
              transition: "width 180ms cubic-bezier(.2,.8,.2,1)",
              overflowX: "hidden",
            },
          }}
        >
          {renderNavContent(effectiveCollapsed)}
        </Drawer>
      )}

      {/* Mobile slide-out temporary drawer */}
      {isMobile && (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              width: 280,
              maxWidth: "86vw",
              boxSizing: "border-box",
              bgcolor: "var(--surface-sidebar)",
              borderRight: "1px solid var(--line)",
            },
          }}
        >
          {renderNavContent(false, () => setMobileOpen(false))}
        </Drawer>
      )}

      {/* Mini sidebar Popover flyout for multi-child sections */}
      <Popover
        id={flyoutId}
        open={!!flyout}
        anchorEl={flyout?.anchor ?? null}
        onClose={() => setFlyout(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              ml: 1,
              minWidth: 224,
              p: 1,
            },
          },
        }}
      >
        {flyout && (
          <Box>
            <Box sx={{ px: 1.25, py: 0.75 }}>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, color: "var(--ink)" }}
              >
                {flyout.item.label}
              </Typography>
            </Box>
            <Divider sx={{ my: 0.5 }} />
            <List disablePadding dense>
              {flyout.item.children?.map((sub) => (
                <Box key={sub.id}>
                  {renderLink({
                    href: sub.href,
                    ariaCurrent: sub.active ? "page" : undefined,
                    onClick: () => setFlyout(null),
                    className: "console-nav-anchor",
                    children: (
                      <ListItemButton selected={!!sub.active}>
                        {sub.icon && (
                          <ListItemIcon
                            sx={{
                              minWidth: 30,
                              color: sub.active
                                ? "var(--accent-50)"
                                : "var(--icon-muted)",
                            }}
                          >
                            {sub.icon}
                          </ListItemIcon>
                        )}
                        <ListItemText
                          primary={sub.label}
                          slotProps={{
                            primary: {
                              sx: {
                                fontSize: 13,
                                fontWeight: sub.active ? 650 : 500,
                              },
                            },
                          }}
                        />
                      </ListItemButton>
                    ),
                  })}
                </Box>
              ))}
            </List>
          </Box>
        )}
      </Popover>

      {/* Main workspace column */}
      <Box
        className="console-main"
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box
          component="header"
          className="console-topbar"
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            display: "flex",
            alignItems: { xs: "stretch", md: "center" },
            justifyContent: "space-between",
            flexDirection: { xs: "column", md: "row" },
            gap: 2,
            px: { xs: 2, sm: 3, md: 4.5 },
            py: { xs: 1.75, md: 2.25 },
            borderBottom: "1px solid var(--line)",
            bgcolor: "var(--surface-topbar)",
            backdropFilter: "blur(14px)",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
            {isMobile && (
              <IconButton
                aria-label="打开导航菜单"
                onClick={() => setMobileOpen(true)}
                sx={{
                  border: "1px solid var(--line)",
                  bgcolor: "var(--surface-card)",
                }}
              >
                <MenuOutlined fontSize="small" />
              </IconButton>
            )}
            <Box sx={{ minWidth: 0 }}>
              {breadcrumbs && breadcrumbs.length > 0 && (
                <Breadcrumbs
                  aria-label="面包屑导航"
                  sx={{
                    mb: 0.25,
                    "& .MuiBreadcrumbs-ol": { fontSize: 12 },
                    color: "var(--muted)",
                  }}
                >
                  {breadcrumbs.map((crumb, idx) =>
                    crumb.href && idx < breadcrumbs.length - 1 ? (
                      <span key={crumb.label}>
                        {renderLink({
                          href: crumb.href,
                          className: "console-breadcrumb-link",
                          children: crumb.label,
                        })}
                      </span>
                    ) : (
                      <Typography
                        key={crumb.label}
                        variant="caption"
                        sx={{ color: "var(--muted)", fontWeight: 600 }}
                      >
                        {crumb.label}
                      </Typography>
                    ),
                  )}
                </Breadcrumbs>
              )}
              {pageTitle && (
                <Typography
                  component="h1"
                  variant="h5"
                  sx={{
                    fontWeight: 750,
                    letterSpacing: "-0.025em",
                    color: "var(--ink)",
                  }}
                >
                  {pageTitle}
                </Typography>
              )}
              {pageSubtitle && (
                <Typography
                  variant="body2"
                  sx={{ color: "var(--muted)", mt: 0.25 }}
                >
                  {pageSubtitle}
                </Typography>
              )}
            </Box>
          </Box>

          {headerActions && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                flexWrap: "wrap",
                "& .mail-field": { minWidth: { xs: "100%", sm: 260 } },
              }}
            >
              {headerActions}
            </Box>
          )}
        </Box>

        <Box
          component="main"
          className="console-content"
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            px: { xs: 2, sm: 3, md: 4.5 },
            py: { xs: 2.25, md: 3.5 },
            display: "flex",
            flexDirection: "column",
            gap: 2.5,
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}

export function ConsolePageTabs({
  value,
  onChange,
  items,
  ariaLabel = "页面分区",
}: {
  value: string;
  onChange: (id: string) => void;
  items: readonly {
    id: string;
    label: string;
    icon?: ReactNode;
    badge?: string | number;
  }[];
  ariaLabel?: string;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: "14px",
        border: "1px solid var(--line)",
        bgcolor: "var(--surface-card)",
        px: 1.5,
        boxShadow: "var(--shadow-card)",
      }}
    >
      <Tabs
        value={value}
        onChange={(_, next) => onChange(String(next))}
        variant="scrollable"
        scrollButtons="auto"
        aria-label={ariaLabel}
      >
        {items.map((item) => (
          <Tab
            key={item.id}
            value={item.id}
            icon={item.icon ? <span>{item.icon}</span> : undefined}
            iconPosition="start"
            label={
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                <span>{item.label}</span>
                {item.badge !== undefined && item.badge !== 0 && (
                  <Chip
                    size="small"
                    label={item.badge}
                    sx={{
                      height: 20,
                      fontSize: 11,
                      bgcolor: "var(--accent-10)",
                      color: "var(--accent-70)",
                    }}
                  />
                )}
              </Box>
            }
          />
        ))}
      </Tabs>
    </Paper>
  );
}

export function ConsoleSectionCard({
  id,
  title,
  description,
  icon,
  badge,
  headerAction,
  children,
  className = "",
}: {
  id?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  badge?: { label: string; tone?: ConsoleTone };
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`console-panel ${className}`.trim()}
    >
      <Box
        component="header"
        sx={{
          display: "flex",
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "space-between",
          flexDirection: { xs: "column", sm: "row" },
          gap: 1.5,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, minWidth: 0 }}>
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
                flexShrink: 0,
                mt: 0.25,
              }}
            >
              {icon}
            </Box>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                flexWrap: "wrap",
              }}
            >
              <Typography
                component="h2"
                variant="subtitle1"
                sx={{ fontWeight: 700, color: "var(--ink)" }}
              >
                {title}
              </Typography>
              {badge && (
                <ConsoleStatusChip
                  label={badge.label}
                  tone={badge.tone ?? "default"}
                />
              )}
            </Box>
            {description && (
              <Typography
                variant="body2"
                sx={{ color: "var(--muted)", mt: 0.5, lineHeight: 1.65 }}
              >
                {description}
              </Typography>
            )}
          </Box>
        </Box>
        {headerAction && (
          <Box sx={{ flexShrink: 0, display: "flex", gap: 1, flexWrap: "wrap" }}>
            {headerAction}
          </Box>
        )}
      </Box>
      {children}
    </section>
  );
}

export function ConsoleAccordionSection({
  id,
  title,
  description,
  icon,
  badge,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  badge?: { label: string; tone?: ConsoleTone };
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Accordion
      id={id}
      defaultExpanded={expanded === undefined ? defaultExpanded : undefined}
      expanded={expanded}
      onChange={(_, next) => onExpandedChange?.(next)}
      sx={{
        boxShadow: "var(--shadow-card)",
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            pr: 1,
            gap: 1.5,
            flexWrap: "wrap",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
            {icon && (
              <Box
                aria-hidden="true"
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: "8px",
                  bgcolor: "var(--surface-inset)",
                  color: "var(--accent-50)",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                {icon}
              </Box>
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, color: "var(--ink)" }}
              >
                {title}
              </Typography>
              {description && (
                <Typography
                  variant="caption"
                  sx={{ display: "block", color: "var(--muted)" }}
                >
                  {description}
                </Typography>
              )}
            </Box>
          </Box>
          {badge && (
            <ConsoleStatusChip
              label={badge.label}
              tone={badge.tone ?? "default"}
            />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>{children}</Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function ConsoleSaveBar({
  dirty,
  saving = false,
  summary = "存在尚未保存的更改",
  saveLabel = "保存更改",
  resetLabel = "还原更改",
  disabled = false,
  onSave,
  onReset,
}: {
  dirty: boolean;
  saving?: boolean;
  summary?: string;
  saveLabel?: string;
  resetLabel?: string;
  disabled?: boolean;
  onSave: () => void;
  onReset?: () => void;
}) {
  if (!dirty && !saving) return null;
  return (
    <Paper
      elevation={0}
      role="region"
      aria-label="未保存配置操作栏"
      className="console-save-bar"
      sx={{
        position: "sticky",
        bottom: 12,
        zIndex: 12,
        mt: 1,
        px: 2.5,
        py: 1.5,
        borderRadius: "14px",
        border: "1px solid var(--accent-30)",
        bgcolor: "var(--surface-overlay)",
        backdropFilter: "blur(16px)",
        boxShadow: "var(--shadow-flyout)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 1.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
        <Box
          aria-hidden="true"
          sx={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            bgcolor: "var(--accent-50)",
            boxShadow: "0 0 0 4px var(--accent-10)",
          }}
        />
        <Typography variant="body2" sx={{ fontWeight: 600, color: "var(--ink)" }}>
          {saving ? "正在保存配置…" : summary}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        {onReset && dirty && (
          <Button
            variant="text"
            size="small"
            disabled={saving || disabled}
            startIcon={<RestartAltOutlined fontSize="small" />}
            onClick={onReset}
          >
            {resetLabel}
          </Button>
        )}
        <Button
          variant="contained"
          size="small"
          disabled={!dirty || saving || disabled}
          startIcon={
            saving ? (
              <CircularProgress size={15} color="inherit" />
            ) : (
              <SaveOutlined fontSize="small" />
            )
          }
          onClick={onSave}
        >
          {saveLabel}
        </Button>
      </Box>
    </Paper>
  );
}

export function ConsoleStatusBanner({
  severity = "info",
  title,
  action,
  role,
  children,
}: {
  severity?: "success" | "info" | "warning" | "error";
  title?: string;
  action?: ReactNode;
  role?: "status" | "alert";
  children: ReactNode;
}) {
  return (
    <Alert
      severity={severity}
      role={role ?? (severity === "error" || severity === "warning" ? "alert" : "status")}
      action={action}
      sx={{
        bgcolor:
          severity === "success"
            ? "var(--success-soft)"
            : severity === "warning"
              ? "var(--warning-soft)"
              : severity === "error"
                ? "var(--danger-soft)"
                : "var(--info-soft)",
        color: "var(--ink)",
        borderColor:
          severity === "success"
            ? "color-mix(in oklab, var(--success), transparent 70%)"
            : severity === "warning"
              ? "color-mix(in oklab, var(--warning), transparent 70%)"
              : severity === "error"
                ? "color-mix(in oklab, var(--danger), transparent 70%)"
                : "color-mix(in oklab, var(--info), transparent 70%)",
      }}
    >
      {title && <AlertTitle sx={{ fontWeight: 700 }}>{title}</AlertTitle>}
      {children}
    </Alert>
  );
}

export function ConsoleStatCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
  action,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: ConsoleTone;
  action?: ReactNode;
}) {
  const s = toneStyles(tone);
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.25,
        borderRadius: "14px",
        border: "1px solid var(--line)",
        bgcolor: "var(--surface-card)",
        boxShadow: "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Typography variant="caption" sx={{ color: "var(--muted)", fontWeight: 600 }}>
          {label}
        </Typography>
        {icon && (
          <Box
            aria-hidden="true"
            sx={{
              width: 30,
              height: 30,
              borderRadius: "8px",
              bgcolor: s.bg,
              color: s.fg,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
      </Box>
      <Typography
        component="strong"
        sx={{
          fontSize: 28,
          fontWeight: 750,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink)",
        }}
      >
        {value}
      </Typography>
      {(hint || action) && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mt: "auto",
          }}
        >
          {hint && (
            <Typography variant="caption" sx={{ color: "var(--muted)" }}>
              {hint}
            </Typography>
          )}
          {action}
        </Box>
      )}
    </Paper>
  );
}
