import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@platform/lib/api", async (original) => ({
  ...(await original<object>()),
  api: request,
}));
import { RegistrationReadiness } from "../readiness";
const report = {
  healthy: false,
  stale: false,
  lastSuccessAt: 0,
  consecutiveFailures: 12,
  requestedEnabled: false,
  effectiveEnabled: false,
  ready: false,
  items: [
    { id: "directory", label: "目录服务与账号管理权限", status: "passed" },
    {
      id: "turnstile",
      label: "Turnstile 配置",
      status: "failed",
      reason: "turnstile_missing",
    },
  ],
  checkedAt: 1,
  humanVerifiedAt: 0,
  releaseVersion: "test",
  protocolScope: "test",
  serviceId: "default",
};
beforeEach(() => {
  request.mockReset();
});
it("explains why verification is disabled and provides the actual repair entry", async () => {
  request.mockResolvedValue(report);
  render(<RegistrationReadiness />);
  await screen.findByText("Turnstile 配置");
  expect(
    screen.getByRole("button", { name: "生成收信验证链接" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("link", { name: /使用 Cloudflare API Token/ }),
  ).toHaveAttribute("href", "/console/site/#turnstile-setup");
  expect(
    screen.getByText(/收信验证入口将在所有自动检查通过后启用/),
  ).toHaveTextContent("1 项待处理");
});
it("shows pending feedback and a visible completion summary for unsuccessful checks", async () => {
  let resolve!: (value: unknown) => void;
  request.mockImplementation((_path: string, options?: RequestInit) =>
    options?.method === "POST"
      ? new Promise((value) => {
          resolve = value;
        })
      : Promise.resolve(report),
  );
  render(<RegistrationReadiness />);
  await screen.findByText("Turnstile 配置");
  fireEvent.click(screen.getByRole("button", { name: "检查注册条件" }));
  expect(screen.getByText(/正在检查运行配置与邮件服务/)).toBeInTheDocument();
  resolve({ ...report, checkedAt: 2 });
  expect(await screen.findByText(/检查完成：1\/2 项通过/)).toBeInTheDocument();
});
it.each([
  [true, true, true, "公开注册已开启。", "人机与收信验证已通过。"],
  [true, false, false, "注册策略已开启，当前暂停接受注册。", "先通过自动检查"],
  [false, true, false, "公开注册未开启。", "勾选「允许公开注册」并保存注册策略"],
])(
  "states the current policy and verification result (policy=%s, verified=%s, open=%s)",
  async (requestedEnabled, ready, effectiveEnabled, registrationStatus, verificationStatus) => {
    request.mockResolvedValue({
      ...report,
      requestedEnabled,
      ready,
      effectiveEnabled,
      humanVerifiedAt: ready ? 123 : 0,
      items: ready ? report.items.map((item) => ({ ...item, status: "passed" })) : report.items,
    });
    render(<RegistrationReadiness />);
    const status = await screen.findByText(registrationStatus);
    expect(status.parentElement).toHaveTextContent(verificationStatus);
    fireEvent.click(screen.getByRole("button", { name: "检查注册条件" }));
    expect(
      await screen.findByText(ready ? "自动检查全部通过。" : /检查完成：1\/2 项通过/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/下一步点击/)).not.toBeInTheDocument();
  },
);
it("exposes the real human-and-mail verification link after all automatic checks pass", async () => {
  const passing = {
    ...report,
    healthy: true,
    items: report.items.map((item) => ({
      ...item,
      status: "passed",
      reason: undefined,
    })),
  };
  request.mockImplementation(async (path: string) =>
    path.includes("/readiness/link")
      ? { url: "https://webmail.example/console/verification/#check=isolated" }
      : passing,
  );
  render(<RegistrationReadiness />);
  const button = await screen.findByRole("button", {
    name: "生成收信验证链接",
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(
    await screen.findByRole("link", { name: /打开人机与收信验证页面/ }),
  ).toHaveAttribute(
    "href",
    "https://webmail.example/console/verification/#check=isolated",
  );
  expect(screen.getByText(/验证链接已生成/)).toBeInTheDocument();
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  try {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    fireEvent.click(screen.getByRole("button", { name: "复制验证链接" }));
    expect(await screen.findByText(/验证链接已复制/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("https://webmail.example/console/verification/#check=isolated");
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("directs a failed callback to certificate diagnostics and enables Hook repair only after a passing probe", async () => {
  const mismatch = {
    id: "hook",
    label: "Stalwart 回调地址与账号范围",
    status: "failed",
    reason: "hook_callback_mismatch",
  };
  const callback = {
    id: "callback",
    label: "Webmail 回调连接与认证",
    status: "passed",
  };
  const failed = {
    ...report,
    items: [
      mismatch,
      { ...callback, status: "failed", reason: "callback_certificate_untrusted" },
    ],
  };
  const reachable = { ...report, items: [mismatch, callback] };
  const repaired = {
    ...report,
    items: [{ ...mismatch, status: "passed" }, callback],
  };
  request.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.includes("/readiness/hook")) return repaired;
    return options?.method === "POST" ? reachable : failed;
  });
  render(<RegistrationReadiness domainId="mail-domain" />);
  const repair = await screen.findByRole("button", {
    name: "更新 Stalwart 回调地址",
  });
  expect(repair).toBeDisabled();
  expect(screen.getByText(/HTTPS 证书校验失败/)).toHaveTextContent("fullchain.pem");
  fireEvent.click(screen.getByRole("button", { name: "检查注册条件" }));
  await waitFor(() => expect(repair).toBeEnabled());
  fireEvent.click(repair);
  await screen.findByText(/Stalwart 回调已更新/);
  expect(request).toHaveBeenCalledWith(
    "/installation/readiness/hook?domainId=mail-domain",
    expect.objectContaining({ method: "POST" }),
  );
});
