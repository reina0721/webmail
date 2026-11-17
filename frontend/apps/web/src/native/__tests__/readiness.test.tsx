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
  fireEvent.click(screen.getByRole("button", { name: "立即检查" }));
  expect(screen.getByText(/正在检查运行配置与邮件服务/)).toBeInTheDocument();
  resolve({ ...report, checkedAt: 2 });
  expect(await screen.findByText(/检查完成：1\/2 项通过/)).toBeInTheDocument();
});
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
});
