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
              main: dark ? "#ff9bbb" : "#dc547f",
              contrastText: dark ? "#24151d" : "#ffffff",
            },
            background: {
              default: dark ? "#17151c" : "#fcf9fb",
              paper: dark ? "#211d27" : "#ffffff",
            },
            text: {
              primary: dark ? "#f5edf3" : "#342d38",
              secondary: dark ? "#b5aab8" : "#817586",
            },
            divider: dark ? "#38303e" : "#eee6ed",
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
              styleOverrides: { root: { borderRadius: 8, minHeight: 36 } },
            },
            MuiIconButton: { styleOverrides: { root: { borderRadius: 8 } } },
            MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
            MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
            MuiTextField: {
              defaultProps: { variant: "outlined", size: "small" },
            },
            MuiTooltip: { defaultProps: { arrow: true } },
            MuiAccordion: {
              styleOverrides: {
                root: {
                  boxShadow: "none",
                  border: "1px solid",
                  borderColor: dark ? "#38303e" : "#eee6ed",
                  "&:before": { display: "none" },
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
    <AppRouterCacheProvider options={{enableCssLayer:true}}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
