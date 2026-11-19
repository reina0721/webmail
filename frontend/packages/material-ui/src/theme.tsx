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

export function MaterialTheme({
  children,
  dark = false,
}: {
  children: ReactNode;
  dark?: boolean;
}) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const theme = useMemo(
    () =>
      createTheme(
        {
          palette: {
            mode: dark ? "dark" : "light",
            primary: {
              main: dark ? "#f497b8" : "#e05681",
              light: dark ? "#ffb6cf" : "#f07ca0",
              dark: dark ? "#d97598" : "#b93d64",
              contrastText: dark ? "#24151d" : "#ffffff",
            },
            success: {
              main: dark ? "#7ad5b1" : "#257b63",
            },
            warning: {
              main: dark ? "#f5bc69" : "#b86c16",
            },
            error: {
              main: dark ? "#ff929c" : "#c84653",
            },
            info: {
              main: dark ? "#8ec1ff" : "#2d6fb8",
            },
            background: {
              default: dark ? "#151218" : "#faf6f8",
              paper: dark ? "#231d29" : "#ffffff",
            },
            text: {
              primary: dark ? "#f5edf3" : "#342d38",
              secondary: dark ? "#b5aab8" : "#7e707d",
            },
            divider: dark ? "#3b3143" : "#eee3e9",
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
            : {}),
          shape: { borderRadius: 10 },
          typography: {
            fontFamily:
              '"Inter", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 14,
            h4: { fontWeight: 750, letterSpacing: "-.03em" },
            h6: { fontWeight: 700 },
            button: { textTransform: "none", fontWeight: 650 },
          },
          components: {
            MuiButton: {
              defaultProps: { disableElevation: true },
              styleOverrides: {
                root: {
                  borderRadius: 10,
                  minHeight: 36,
                  paddingInline: 14,
                  transition:
                    "background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
                },
                contained: {
                  "&.MuiButton-containedPrimary": {
                    boxShadow: dark
                      ? "0 3px 10px rgb(0 0 0 / 0.28)"
                      : "0 3px 10px rgb(224 86 129 / 0.22)",
                    "&:hover": {
                      boxShadow: dark
                        ? "0 5px 14px rgb(0 0 0 / 0.36)"
                        : "0 6px 14px rgb(224 86 129 / 0.28)",
                    },
                    "&:active": {
                      boxShadow: "none",
                    },
                  },
                },
                outlined: {
                  borderColor: dark ? "#463a50" : "#e7d8e1",
                },
              },
            },
            MuiIconButton: {
              styleOverrides: {
                root: {
                  borderRadius: 10,
                  color: dark ? "#bdb0bc" : "#6f5f6c",
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
                  backgroundColor: dark ? "#1c1721" : "#fdf9fb",
                  borderColor: dark ? "#3b3143" : "#eee3e9",
                },
              },
            },
            MuiDialog: {
              styleOverrides: {
                paper: {
                  borderRadius: 16,
                  border: "1px solid",
                  borderColor: dark ? "#3b3143" : "#eee3e9",
                },
              },
            },
            MuiPopover: {
              styleOverrides: {
                paper: {
                  borderRadius: 14,
                  border: "1px solid",
                  borderColor: dark ? "#463a50" : "#ecdce4",
                  backgroundColor: dark
                    ? "rgb(35 29 41 / 0.94)"
                    : "rgb(255 252 254 / 0.94)",
                  backdropFilter: "blur(16px)",
                  boxShadow: dark
                    ? "0 14px 36px rgb(0 0 0 / 0.45)"
                    : "0 12px 32px rgb(85 48 68 / 0.14)",
                },
              },
            },
            MuiTextField: {
              defaultProps: { variant: "outlined", size: "small" },
            },
            MuiOutlinedInput: {
              styleOverrides: {
                root: {
                  borderRadius: 10,
                },
              },
            },
            MuiTooltip: {
              defaultProps: { arrow: true },
              styleOverrides: {
                tooltip: {
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 550,
                  backgroundColor: dark ? "#2e2636" : "#342d38",
                  color: "#fdf9fb",
                },
                arrow: {
                  color: dark ? "#2e2636" : "#342d38",
                },
              },
            },
            MuiListItemButton: {
              styleOverrides: {
                root: {
                  borderRadius: 10,
                  marginBlock: 2,
                  paddingBlock: 8,
                  paddingInline: 12,
                  transition: "background-color 150ms ease, color 150ms ease",
                  "&:hover": {
                    backgroundColor: dark
                      ? "rgb(244 151 184 / 0.08)"
                      : "rgb(224 86 129 / 0.06)",
                  },
                  "&.Mui-selected": {
                    backgroundColor: dark ? "#392432" : "#fdeef3",
                    color: dark ? "#ffc7de" : "#a33357",
                    fontWeight: 650,
                    "& .MuiListItemIcon-root": {
                      color: dark ? "#f497b8" : "#e05681",
                    },
                    "&:hover": {
                      backgroundColor: dark ? "#452b3c" : "#fbe2eb",
                    },
                  },
                },
              },
            },
            MuiChip: {
              styleOverrides: {
                root: {
                  borderRadius: 8,
                  fontWeight: 600,
                },
              },
            },
            MuiTabs: {
              styleOverrides: {
                indicator: {
                  height: 3,
                  borderRadius: 3,
                },
              },
            },
            MuiTab: {
              styleOverrides: {
                root: {
                  textTransform: "none",
                  fontWeight: 600,
                  minHeight: 42,
                  borderRadius: "8px 8px 0 0",
                },
              },
            },
            MuiAlert: {
              styleOverrides: {
                root: {
                  borderRadius: 12,
                  border: "1px solid",
                  borderColor: dark ? "#3b3143" : "#eee3e9",
                  alignItems: "center",
                },
              },
            },
            MuiAccordion: {
              styleOverrides: {
                root: {
                  borderRadius: 14,
                  boxShadow: "none",
                  border: "1px solid",
                  borderColor: dark ? "#3b3143" : "#eee3e9",
                  backgroundColor: dark ? "#231d29" : "#ffffff",
                  "&:before": { display: "none" },
                  "&:first-of-type": {
                    borderTopLeftRadius: 14,
                    borderTopRightRadius: 14,
                  },
                  "&:last-of-type": {
                    borderBottomLeftRadius: 14,
                    borderBottomRightRadius: 14,
                  },
                  "& + &": { marginTop: 10 },
                },
              },
            },
            MuiAccordionSummary: {
              styleOverrides: {
                root: {
                  minHeight: 54,
                  paddingInline: 20,
                  borderRadius: 14,
                },
              },
            },
            MuiAccordionDetails: {
              styleOverrides: {
                root: {
                  paddingInline: 20,
                  paddingBottom: 20,
                },
              },
            },
          },
        },
        zhCN,
      ),
    [dark, reduced],
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
