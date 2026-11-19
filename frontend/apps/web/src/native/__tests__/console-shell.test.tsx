import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConsoleDomain, useConsoleSidebar } from "@/stores/native-host-store";
import { DEFAULT_SITE_METADATA } from "../site-defaults";

const request = vi.hoisted(() => vi.fn());
vi.mock("@platform/lib/api", async (original) => ({
  ...(await original<object>()),
  api: request,
}));

import { Console } from "../console";

const baseConnections = {
  services: [
    { id: "default", name: "Primary", origin: "https://mail.example.com", configured: true },
  ],
  domains: [
    { id: "default", name: "example.com", serviceId: "default", serviceName: "Primary" },
  ],
};

const sampleUsers = [
  {
    id: "u1",
    email: "admin@example.com",
    status: "active",
    operator: true,
    quotaBytes: 1024 * 1048576,
    hourlyRecipients: 100,
    dailyRecipients: 500,
  },
  {
    id: "u2",
    email: "alice@example.com",
    status: "active",
    operator: false,
    quotaBytes: 512 * 1048576,
    hourlyRecipients: 50,
    dailyRecipients: 200,
  },
  {
    id: "u3",
    email: "locked@example.com",
    status: "disabled",
    operator: false,
    quotaBytes: 256 * 1048576,
    hourlyRecipients: 10,
    dailyRecipients: 50,
  },
];

beforeEach(() => {
  useConsoleDomain.setState({ domain: "default" });
  useConsoleSidebar.setState({
    collapsed: null,
    expandedGroups: { site: true, activity: false },
  });
  history.replaceState({}, "", "/console/site/");
  request.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/auth/session") {
      return { id: "u1", email: "admin@example.com", operator: true };
    }
    if (path === "/installation/connections") return baseConnections;
    if (path.startsWith("/admin/users")) return { items: sampleUsers };
    if (path.startsWith("/admin/registration")) {
      return {
        policy: {
          enabled: false,
          maximumAccounts: 50,
          quotaBytes: 1048576,
          attachmentBytes: 1048576,
          hourlyRecipients: 50,
          dailyRecipients: 200,
        },
      };
    }
    if (path.startsWith("/admin/tasks")) {
      return {
        accountPolicyJobs: 2,
        credentialRevocations: 0,
        registrationReconciliation: 1,
      };
    }
    if (path.startsWith("/admin/audit")) {
      return {
        items: [
          {
            id: "a1",
            actorId: "u1",
            subjectId: "u2",
            action: "user.quota.updated",
            outcome: "success",
            createdAt: 1700000000000,
          },
        ],
      };
    }
    if (path.startsWith("/admin/automatic-mail")) {
      return { configured: true, status: "ready", items: [] };
    }
    if (path.startsWith("/installation/readiness")) {
      return {
        healthy: true,
        stale: false,
        lastSuccessAt: 100,
        consecutiveFailures: 0,
        requestedEnabled: false,
        effectiveEnabled: false,
        ready: true,
        items: [{ id: "directory", label: "目录服务与账号管理权限", status: "passed" }],
        checkedAt: 100,
        humanVerifiedAt: 100,
        releaseVersion: "1.0.0",
        protocolScope: "jmap",
        serviceId: "default",
      };
    }
    if (path === "/installation/config") {
      return {
        settings: {
          brand: "Mail Web",
          publicOrigin: "https://mail.example.com",
          turnstileSiteKey: "",
        },
        turnstileSecretSet: false,
      };
    }
    if (path === "/admin/site" && !init?.method) {
      return DEFAULT_SITE_METADATA;
    }
    if (path === "/admin/site" && init?.method === "PUT") {
      return JSON.parse(String(init.body));
    }
    if (path === "/admin/client-policy") {
      return {
        mailLayout: "split",
        sendDelaySeconds: 5,
        externalContentPolicy: "ask",
        sharingEnabled: true,
        sharingWriteEnabled: false,
      };
    }
    if (path === "/health/ready") {
      return { version: "1.0.0", revision: "abcdef123456" };
    }
    throw new Error(`Unexpected path: ${path}`);
  });
});

describe("console shell & hybrid sidebar", () => {
  it("supports accordion submenu expand/collapse and mini-mode popover navigation", async () => {
    render(<Console section="site" />);
    await screen.findByRole("tab", { name: "基础地址与品牌" });

    // Site accordion group starts expanded; sub-links are visible
    expect(
      screen.getByRole("link", { name: "图标与登录外观" }),
    ).toBeInTheDocument();

    // Collapse site submenu via accordion toggle button
    fireEvent.click(
      screen.getByRole("button", { name: "收起站点与默认设置子菜单" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "图标与登录外观" }),
      ).not.toBeInTheDocument(),
    );

    // Toggle mini sidebar mode and verify persisted state + Popover submenu
    fireEvent.click(screen.getByRole("button", { name: "折叠侧边栏" }));
    expect(useConsoleSidebar.getState().collapsed).toBe(true);
    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeInTheDocument();

    // Open mini flyout popover for site section and navigate to branding sub-tab
    const miniSiteBtn = screen.getByRole("button", { name: "站点与默认设置" });
    fireEvent.click(miniSiteBtn);
    const brandingItem = await screen.findByRole("link", {
      name: "图标与登录外观",
    });
    fireEvent.click(brandingItem);

    expect(
      await screen.findByRole("heading", { name: "站点图标与品牌徽标" }),
    ).toBeInTheDocument();
  });

  it("splits /console/site into focused tabs, deduplicates brand input, and surfaces sticky save bar", async () => {
    render(<Console section="site" />);
    await screen.findByRole("textbox", { name: "站点名称" });

    // Duplicate "站点显示名称" from SiteMetadataSettings must not appear in general tab
    expect(
      screen.queryByRole("textbox", { name: "站点显示名称" }),
    ).not.toBeInTheDocument();

    // Editing a metadata field triggers sticky ConsoleSaveBar
    const shortName = await screen.findByRole("textbox", { name: "PWA 短名称" });
    fireEvent.change(shortName, { target: { value: "SakuraMail" } });
    expect(
      screen.getByRole("region", { name: "未保存配置操作栏" }),
    ).toBeInTheDocument();

    // Switching to Turnstile tab keeps unsaved indicator and renders TurnstileSetup
    fireEvent.click(screen.getByRole("tab", { name: "Turnstile 人机验证" }));
    expect(
      await screen.findByRole("heading", { name: "自动配置 Turnstile 人机验证" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "未保存配置操作栏" }),
    ).toBeInTheDocument();
  });

  it("auto-selects Turnstile tab when landing on /console/site/#turnstile-setup", async () => {
    history.replaceState({}, "", "/console/site/#turnstile-setup");
    render(<Console section="site" />);
    expect(
      await screen.findByRole("heading", { name: "自动配置 Turnstile 人机验证" }),
    ).toBeInTheDocument();
  });

  it("switches /console/activity sub-tabs cleanly without stacking unrelated panels", async () => {
    history.replaceState({}, "", "/console/activity/");
    render(<Console section="activity" />);

    expect(
      await screen.findByRole("heading", { name: "后台任务" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "审计记录" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "审计与部署" }));
    expect(
      await screen.findByRole("heading", { name: "审计记录" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "后台任务" }),
    ).not.toBeInTheDocument();
  });

  it("filters users via status chips and opens slide-out edit drawer", async () => {
    history.replaceState({}, "", "/console/users/");
    render(<Console section="users" />);

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("locked@example.com")).toBeInTheDocument();

    // Filter to disabled accounts
    fireEvent.click(screen.getByRole("button", { name: "已停用 (1)" }));
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("locked@example.com")).toBeInTheDocument();

    // Open slide-out edit drawer
    fireEvent.click(screen.getByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "账号与配额" });
    expect(dialog).toHaveTextContent("locked@example.com");
  });
});
