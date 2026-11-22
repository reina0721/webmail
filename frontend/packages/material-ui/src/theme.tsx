"use client";
import { useMemo, type ReactNode } from "react";
import {
  createTheme,
  ThemeProvider,
  CssBaseline,
  useMediaQuery,
} from "@mui/material";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { zhCN } from "@mui/material/locale";

export type AccentPresetId =
  | "sakura"
  | "sky"
  | "violet"
  | "forest"
  | "amber"
  | "cyan";

export interface AccentPreset {
  id: AccentPresetId;
  label: string;
  tagline: string;
  light: {
    main: string;
    light: string;
    dark: string;
    contrastText: string;
    soft: string;
    softText: string;
    softHover: string;
  };
  dark: {
    main: string;
    light: string;
    dark: string;
    contrastText: string;
    soft: string;
    softText: string;
    softHover: string;
  };
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  {
    id: "sakura",
    label: "樱花粉",
    tagline: "Sakura",
    light: {
      main: "#e05681",
      light: "#f07ca0",
      dark: "#b83b63",
      contrastText: "#ffffff",
      soft: "#fdeef3",
      softText: "#a33357",
      softHover: "#fbe2eb",
    },
    dark: {
      main: "#f497b8",
      light: "#ffb6cf",
      dark: "#d97598",
      contrastText: "#24151d",
      soft: "#392432",
      softText: "#ffc7de",
      softHover: "#462c3d",
    },
  },
  {
    id: "sky",
    label: "晴空蓝",
    tagline: "Sky",
    light: {
      main: "#3b78d8",
      light: "#6698e6",
      dark: "#295cb0",
      contrastText: "#ffffff",
      soft: "#edf3fd",
      softText: "#2554a1",
      softHover: "#e0ebfc",
    },
    dark: {
      main: "#82b6ff",
      light: "#a8cdff",
      dark: "#5c96e6",
      contrastText: "#101b2e",
      soft: "#1f2c40",
      softText: "#c5deff",
      softHover: "#283852",
    },
  },
  {
    id: "violet",
    label: "紫罗兰",
    tagline: "Violet",
    light: {
      main: "#8e44ad",
      light: "#aa69c4",
      dark: "#6f318a",
      contrastText: "#ffffff",
      soft: "#f5eef9",
      softText: "#682c82",
      softHover: "#ece0f5",
    },
    dark: {
      main: "#d0a2f7",
      light: "#e1c2fa",
      dark: "#b37ee3",
      contrastText: "#22132e",
      soft: "#31233e",
      softText: "#e6cefc",
      softHover: "#3d2c4d",
    },
  },
  {
    id: "forest",
    label: "森林绿",
    tagline: "Forest",
    light: {
      main: "#2f8547",
      light: "#55a46b",
      dark: "#216634",
      contrastText: "#ffffff",
      soft: "#ebf6ee",
      softText: "#1f5f31",
      softHover: "#ddf0e2",
    },
    dark: {
      main: "#7ad899",
      light: "#a0e5b7",
      dark: "#55bd79",
      contrastText: "#102518",
      soft: "#1c3324",
      softText: "#bdf0cd",
      softHover: "#24422f",
    },
  },
  {
    id: "amber",
    label: "琥珀橙",
    tagline: "Amber",
    light: {
      main: "#c46d10",
      light: "#dc8d36",
      dark: "#9c5308",
      contrastText: "#ffffff",
      soft: "#fdf3e7",
      softText: "#8f4c08",
      softHover: "#fae7d1",
    },
    dark: {
      main: "#f5bc69",
      light: "#f8d094",
      dark: "#dfa047",
      contrastText: "#2a1b08",
      soft: "#382a18",
      softText: "#fce0b3",
      softHover: "#47361f",
    },
  },
  {
    id: "cyan",
    label: "青岚蓝",
    tagline: "Cyan",
    light: {
      main: "#168098",
      light: "#3d9eb5",
      dark: "#0f6275",
      contrastText: "#ffffff",
      soft: "#e9f6f9",
      softText: "#0f5c6e",
      softHover: "#d9eef3",
    },
    dark: {
      main: "#6fd2e6",
      light: "#98e1f0",
      dark: "#4ab9cf",
      contrastText: "#0c232a",
      soft: "#193138",
      softText: "#b8edf7",
      softHover: "#213f47",
    },
  },
] as const;

export function getAccentPreset(id?: AccentPresetId | string | null): AccentPreset {
  return ACCENT_PRESETS.find((preset) => preset.id === id) ?? ACCENT_PRESETS[0];
}

export function MaterialTheme({
  children,
  dark = false,
  accent = "sakura",
}: {
  children: ReactNode;
  dark?: boolean;
  accent?: AccentPresetId;
}) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const preset = getAccentPreset(accent);
  const tone = dark ? preset.dark : preset.light;
  const expo = "cubic-bezier(0.19, 1, 0.22, 1)";
  const spring = "cubic-bezier(0.175, 0.885, 0.32, 1.275)";

  const theme = useMemo(
    () =>
      createTheme(
        {
          palette: {
            mode: dark ? "dark" : "light",
            primary: {
              main: tone.main,
              light: tone.light,
              dark: tone.dark,
              contrastText: tone.contrastText,
            },
            success: {
              main: dark ? "#7ad5b1" : "#237a60",
            },
            warning: {
              main: dark ? "#f5bc69" : "#b56812",
            },
            error: {
              main: dark ? "#ff929c" : "#c6414f",
            },
            info: {
              main: dark ? "#8ec1ff" : "#2a6db5",
            },
            background: {
              default: dark ? "#141217" : "#f9f7f9",
              paper: dark ? "#211d27" : "#ffffff",
            },
            text: {
              primary: dark ? "#f4ecf2" : "#2f2933",
              secondary: dark ? "#b0a5b4" : "#726573",
            },
            divider: dark ? "#393242" : "#e8e1e7",
          },
          ...(reduced
            ? {
                transitions: {
                  duration: {
                    shortest: 0,
                    shorter: 0,
                    short: 0,
                    standard: 0,
                    complex: 0,
                    enteringScreen: 0,
                    leavingScreen: 0,
                  },
                },
              }
            : {
                transitions: {
                  easing: {
                    easeInOut: expo,
                    easeOut: expo,
                    easeIn: "cubic-bezier(0.4, 0, 1, 1)",
                    sharp: "cubic-bezier(0.1, 0.9, 0.2, 1)",
                  },
                  duration: {
                    shortest: 90,
                    shorter: 140,
                    short: 180,
                    standard: 220,
                    complex: 260,
                    enteringScreen: 180,
                    leavingScreen: 140,
                  },
                },
              }),
          shape: { borderRadius: 8 },
          typography: {
            fontFamily:
              '"Inter", "Noto Sans SC", "Source Han Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 13.5,
            h4: { fontWeight: 750, letterSpacing: "-.03em" },
            h5: { fontWeight: 750, letterSpacing: "-.025em" },
            h6: { fontWeight: 700, letterSpacing: "-.015em" },
            subtitle1: { fontWeight: 650 },
            subtitle2: { fontWeight: 650 },
            button: { textTransform: "none", fontWeight: 620 },
          },
          components: {
            MuiButtonBase: {
              styleOverrides: {
                root: {
                  "& .MuiTouchRipple-child": {
                    backgroundColor: "var(--accent-50)",
                  },
                },
              },
            },
            MuiButton: {
              defaultProps: { disableElevation: true },
              styleOverrides: {
                root: {
                  borderRadius: 8,
                  minHeight: 34,
                  paddingInline: 13,
                  fontSize: 13,
                  lineHeight: 1.35,
                  transition: reduced
                    ? "none"
                    : `background-color 140ms ${expo}, border-color 140ms ${expo}, color 140ms ${expo}, box-shadow 180ms ${expo}, transform 120ms ${expo}`,
                  "&:active:not(:disabled)": reduced
                    ? {}
                    : {
                        transform: "scale(0.985) translateY(1px)",
                      },
                },
                sizeSmall: {
                  minHeight: 30,
                  paddingInline: 10,
                  fontSize: 12.5,
                },
                sizeLarge: {
                  minHeight: 40,
                  paddingInline: 18,
                  fontSize: 14,
                },
                contained: {
                  "&.MuiButton-containedPrimary": {
                    boxShadow: "var(--shadow-button)",
                    "&:hover": {
                      boxShadow: "var(--shadow-button-hover)",
                    },
                    "&:active": {
                      boxShadow: "none",
                    },
                  },
                },
                outlined: {
                  borderColor: "var(--line-strong)",
                  backgroundColor: "var(--surface-card)",
                  "&:hover": {
                    borderColor: "var(--accent-30)",
                    backgroundColor: "var(--accent-hover-overlay)",
                  },
                },
                text: {
                  "&:hover": {
                    backgroundColor: "var(--accent-hover-overlay)",
                  },
                },
              },
            },
            MuiIconButton: {
              styleOverrides: {
                root: {
                  borderRadius: 8,
                  color: "var(--icon-muted)",
                  transition: reduced
                    ? "none"
                    : `background-color 140ms ${expo}, color 140ms ${expo}, transform 120ms ${expo}`,
                  "&:hover": {
                    backgroundColor: "var(--accent-hover-overlay)",
                    color: "var(--ink)",
                  },
                  "&:active:not(:disabled)": reduced
                    ? {}
                    : {
                        transform: "scale(0.94)",
                      },
                },
              },
            },
            MuiPaper: {
              styleOverrides: {
                root: {
                  backgroundImage: "none",
                },
              },
            },
            MuiDrawer: {
              styleOverrides: {
                paper: {
                  backgroundImage: "none",
                  backgroundColor: "var(--surface-sidebar)",
                  borderColor: "var(--line)",
                },
              },
            },
            MuiDialog: {
              styleOverrides: {
                backdrop: {
                  backgroundColor: dark ? "rgb(10 8 14 / 0.62)" : "rgb(26 18 28 / 0.34)",
                  backdropFilter: "blur(4px)",
                },
                paper: {
                  borderRadius: 14,
                  border: "1px solid var(--line)",
                  backgroundColor: "var(--surface-card)",
                  boxShadow: "var(--shadow-flyout)",
                },
              },
            },
            MuiDialogTitle: {
              styleOverrides: {
                root: {
                  fontSize: 16,
                  fontWeight: 700,
                  padding: "16px 20px 12px",
                },
              },
            },
            MuiDialogContent: {
              styleOverrides: {
                root: {
                  padding: "8px 20px 18px",
                },
              },
            },
            MuiDialogActions: {
              styleOverrides: {
                root: {
                  padding: "12px 20px",
                  gap: 8,
                  borderTop: "1px solid var(--line)",
                },
              },
            },
            MuiPopover: {
              styleOverrides: {
                paper: {
                  borderRadius: 12,
                  border: "1px solid var(--line-strong)",
                  backgroundColor: "var(--surface-overlay)",
                  backdropFilter: "blur(var(--surface-acrylic-blur, 16px))",
                  boxShadow: "var(--shadow-flyout)",
                },
              },
            },
            MuiMenu: {
              styleOverrides: {
                list: {
                  padding: 4,
                },
              },
            },
            MuiMenuItem: {
              styleOverrides: {
                root: {
                  borderRadius: 7,
                  minHeight: 34,
                  paddingBlock: 6,
                  paddingInline: 10,
                  fontSize: 13,
                  transition: reduced ? "none" : `background-color 120ms ${expo}, color 120ms ${expo}`,
                  "&:hover": {
                    backgroundColor: "var(--accent-hover-overlay)",
                  },
                  "&.Mui-selected": {
                    backgroundColor: "var(--accent-10)",
                    color: "var(--accent-70)",
                    fontWeight: 600,
                    "&:hover": {
                      backgroundColor: "var(--accent-15)",
                    },
                  },
                },
              },
            },
            MuiTextField: {
              defaultProps: { variant: "outlined", size: "small" },
            },
            MuiOutlinedInput: {
              styleOverrides: {
                root: {
                  borderRadius: 8,
                  fontSize: 13.5,
                  backgroundColor: "var(--surface-inset)",
                  transition: reduced
                    ? "none"
                    : `background-color 140ms ${expo}, box-shadow 160ms ${expo}, border-color 140ms ${expo}`,
                  "& .MuiOutlinedInput-notchedOutline": {
                    borderColor: "var(--line)",
                    transition: reduced ? "none" : `border-color 140ms ${expo}`,
                  },
                  "&:hover:not(.Mui-disabled):not(.Mui-focused)": {
                    backgroundColor: "var(--surface-card)",
                    "& .MuiOutlinedInput-notchedOutline": {
                      borderColor: "var(--line-strong)",
                    },
                  },
                  "&.Mui-focused": {
                    backgroundColor: "var(--surface-card)",
                    boxShadow: "0 0 0 3px var(--accent-focus-ring)",
                  },
                },
                input: {
                  "&.MuiInputBase-inputSizeSmall": {
                    paddingBlock: 7.5,
                  },
                },
              },
            },
            MuiInputLabel: {
              styleOverrides: {
                root: {
                  fontSize: 13,
                },
              },
            },
            MuiSwitch: {
              styleOverrides: {
                root: {
                  width: 44,
                  height: 26,
                  padding: 4,
                },
                switchBase: {
                  padding: 5,
                  transition: reduced ? "none" : `transform 200ms ${spring}, color 140ms ${expo}`,
                  "&.Mui-checked": {
                    transform: "translateX(18px)",
                    color: "var(--accent-contrast)",
                    "& + .MuiSwitch-track": {
                      backgroundColor: "var(--accent-50)",
                      opacity: 1,
                      borderColor: "var(--accent-50)",
                    },
                  },
                },
                thumb: {
                  width: 16,
                  height: 16,
                  boxShadow: "var(--shadow-xs)",
                },
                track: {
                  borderRadius: 999,
                  backgroundColor: "var(--surface-inset)",
                  border: "1px solid var(--line-strong)",
                  opacity: 1,
                  transition: reduced ? "none" : `background-color 160ms ${expo}, border-color 160ms ${expo}`,
                },
              },
            },
            MuiCheckbox: {
              styleOverrides: {
                root: {
                  padding: 6,
                  borderRadius: 6,
                  color: "var(--icon-muted)",
                  transition: reduced ? "none" : `color 140ms ${expo}, background-color 140ms ${expo}`,
                },
              },
            },
            MuiSlider: {
              styleOverrides: {
                root: {
                  height: 4,
                  paddingBlock: 10,
                },
                rail: {
                  opacity: 1,
                  backgroundColor: "var(--line-strong)",
                  borderRadius: 999,
                },
                track: {
                  borderRadius: 999,
                },
                thumb: {
                  width: 14,
                  height: 14,
                  backgroundColor: "var(--surface-card)",
                  border: "2px solid var(--accent-50)",
                  boxShadow: "var(--shadow-xs)",
                  "&:hover, &.Mui-focusVisible": {
                    boxShadow: "0 0 0 5px var(--accent-focus-ring)",
                  },
                },
              },
            },
            MuiLinearProgress: {
              styleOverrides: {
                root: {
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: "var(--surface-inset)",
                  overflow: "hidden",
                },
                bar: {
                  borderRadius: 999,
                  transition: reduced ? "none" : "transform 280ms cubic-bezier(0.1, 0.9, 0.2, 1)",
                },
              },
            },
            MuiTooltip: {
              defaultProps: { arrow: true, enterDelay: 260 },
              styleOverrides: {
                tooltip: {
                  borderRadius: 7,
                  fontSize: 12,
                  fontWeight: 550,
                  padding: "5px 9px",
                  backgroundColor: dark ? "#2e2736" : "#2f2933",
                  color: "#fdf9fb",
                  boxShadow: "var(--shadow-xs)",
                },
                arrow: {
                  color: dark ? "#2e2736" : "#2f2933",
                },
              },
            },
            MuiListItemButton: {
              styleOverrides: {
                root: {
                  borderRadius: 8,
                  marginBlock: 1.5,
                  paddingBlock: 6.5,
                  paddingInline: 10,
                  transition: reduced
                    ? "none"
                    : `background-color 140ms ${expo}, color 140ms ${expo}, transform 120ms ${expo}`,
                  "&:hover": {
                    backgroundColor: "var(--accent-hover-overlay)",
                  },
                  "&:active:not(:disabled)": reduced
                    ? {}
                    : {
                        transform: "scale(0.99)",
                      },
                  "&.Mui-selected": {
                    backgroundColor: tone.soft,
                    color: tone.softText,
                    fontWeight: 650,
                    "& .MuiListItemIcon-root": {
                      color: tone.main,
                    },
                    "&:hover": {
                      backgroundColor: tone.softHover,
                    },
                  },
                },
              },
            },
            MuiChip: {
              styleOverrides: {
                root: {
                  borderRadius: 7,
                  fontWeight: 600,
                  fontSize: 12,
                  transition: reduced
                    ? "none"
                    : `background-color 140ms ${expo}, border-color 140ms ${expo}, transform 120ms ${expo}`,
                },
                clickable: {
                  "&:active": reduced ? {} : { transform: "scale(0.96)" },
                },
              },
            },
            MuiTabs: {
              styleOverrides: {
                root: {
                  minHeight: 38,
                },
                indicator: {
                  height: 3,
                  borderRadius: 999,
                  transition: reduced
                    ? "none"
                    : "all 240ms cubic-bezier(0.075, 0.82, 0.165, 1)",
                },
              },
            },
            MuiTab: {
              styleOverrides: {
                root: {
                  textTransform: "none",
                  fontWeight: 600,
                  fontSize: 13,
                  minHeight: 38,
                  paddingBlock: 7,
                  paddingInline: 12,
                  borderRadius: "8px 8px 0 0",
                  transition: reduced
                    ? "none"
                    : `color 140ms ${expo}, background-color 140ms ${expo}`,
                  "&:hover": {
                    backgroundColor: "var(--accent-hover-overlay)",
                  },
                },
              },
            },
            MuiAlert: {
              styleOverrides: {
                root: {
                  borderRadius: 10,
                  border: "1px solid var(--line)",
                  paddingBlock: 6,
                  paddingInline: 14,
                  fontSize: 13,
                  alignItems: "center",
                },
              },
            },
            MuiAccordion: {
              styleOverrides: {
                root: {
                  borderRadius: 12,
                  boxShadow: "none",
                  border: "1px solid var(--line)",
                  backgroundColor: "var(--surface-card)",
                  "&:before": { display: "none" },
                  "&:first-of-type": {
                    borderTopLeftRadius: 12,
                    borderTopRightRadius: 12,
                  },
                  "&:last-of-type": {
                    borderBottomLeftRadius: 12,
                    borderBottomRightRadius: 12,
                  },
                  "& + &": { marginTop: 8 },
                },
              },
            },
            MuiAccordionSummary: {
              styleOverrides: {
                root: {
                  minHeight: 48,
                  paddingInline: 16,
                  borderRadius: 12,
                  "&.Mui-expanded": {
                    minHeight: 48,
                  },
                },
                content: {
                  marginBlock: 10,
                  "&.Mui-expanded": {
                    marginBlock: 10,
                  },
                },
                expandIconWrapper: {
                  transition: reduced ? "none" : "transform 220ms cubic-bezier(0.1, 0.9, 0.2, 1)",
                },
              },
            },
            MuiAccordionDetails: {
              styleOverrides: {
                root: {
                  paddingInline: 16,
                  paddingBottom: 16,
                  paddingTop: 4,
                },
              },
            },
            MuiSkeleton: {
              styleOverrides: {
                root: {
                  backgroundColor: "var(--surface-inset)",
                  borderRadius: 6,
                },
              },
            },
          },
        },
        zhCN,
      ),
    [dark, reduced, tone],
  );

  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
