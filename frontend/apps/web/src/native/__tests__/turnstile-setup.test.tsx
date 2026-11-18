import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@platform/lib/api", async (original) => ({
  ...(await original<object>()),
  api: request,
}));
vi.mock("@platform/host/use-installation-leave", () => ({
  useInstallationLeave: () => ({ href: "", cancel: vi.fn(), leave: vi.fn() }),
}));
import { ApiError } from "@platform/lib/api";
import { TurnstileSetup } from "../turnstile-setup";
const account = "a".repeat(32);
let applied = false;
beforeEach(() => {
  applied = false;
  request.mockReset().mockImplementation(async (path: string) => {
    if (path === "/installation/config")
      return {
        settings: { turnstileSiteKey: applied ? "owned-site" : "" },
        turnstileSecretSet: applied,
      };
    if (path === "/installation/turnstile/accounts") return { accounts: [] };
    if (path === "/installation/turnstile") {
      applied = true;
      return { configured: true };
    }
    throw new Error("Unexpected request: " + path);
  });
});
it("repairs a missing account listing with an Account ID and only a Cloudflare token", async () => {
  const onApplied = vi.fn();
  render(<TurnstileSetup onApplied={onApplied} />);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/installation/config",
      expect.anything(),
    ),
  );
  fireEvent.change(screen.getByLabelText("Cloudflare API Token"), {
    target: { value: "isolated-token" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "自动创建并保存验证配置" }),
  );
  await screen.findByText(/此 Token 未能读取 Cloudflare 账号/);
  expect(
    request.mock.calls.some(([path]) => path === "/installation/turnstile"),
  ).toBe(false);
  expect(screen.getByLabelText("Cloudflare API Token")).toHaveValue(
    "isolated-token",
  );
  fireEvent.change(screen.getByLabelText("Cloudflare Account ID"), {
    target: { value: account },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "自动创建并保存验证配置" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/installation/turnstile",
      expect.objectContaining({
        body: JSON.stringify({
          cloudflareToken: "isolated-token",
          cloudflareAccount: account,
        }),
      }),
    ),
  );
  await screen.findByText("Turnstile 已配置。", {}, { timeout: 3000 });
  expect(onApplied).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByLabelText("Cloudflare API Token"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /进入注册与收信验证/ }),
  ).toHaveAttribute("href", "/console/registration/");
  expect(
    request.mock.calls.some(([path]) => String(path).includes("/initialize/")),
  ).toBe(false);
});
it("requires an account and displays an explicit provider error without discarding the token", async () => {
  request.mockImplementation(async (path: string) => {
    if (path === "/installation/config")
      return { settings: {}, turnstileSecretSet: false };
    throw new ApiError(502, "cloudflare_permission_denied");
  });
  render(<TurnstileSetup />);
  fireEvent.change(screen.getByLabelText("Cloudflare API Token"), {
    target: { value: "isolated-token" },
  });
  const button = screen.getByRole("button", { name: "自动创建并保存验证配置" });
  expect(button).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Cloudflare Account ID"), {
    target: { value: "not-an-account" },
  });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Cloudflare Account ID"), {
    target: { value: account },
  });
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent(/Token 权限不足/);
  expect(screen.getByLabelText("Cloudflare API Token")).toHaveValue(
    "isolated-token",
  );
});
it("discovers the single account and automatically configures Turnstile with one button", async () => {
  const provider = request.getMockImplementation()!;
  request.mockImplementation(async (path: string, options?: RequestInit) =>
    path === "/installation/turnstile/accounts"
      ? { accounts: [{ id: account, name: "My account" }] }
      : provider(path, options),
  );
  render(<TurnstileSetup />);
  fireEvent.change(screen.getByLabelText("Cloudflare API Token"), {
    target: { value: "isolated-token" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "自动创建并保存验证配置" }),
  );
  await screen.findByText("Turnstile 已配置。", {}, { timeout: 3000 });
  expect(request).toHaveBeenCalledWith(
    "/installation/turnstile",
    expect.objectContaining({
      body: JSON.stringify({
        cloudflareToken: "isolated-token",
        cloudflareAccount: account,
      }),
    }),
  );
});

it("creates nothing if the token exposes multiple accounts and no account is selected", async () => {
  const provider = request.getMockImplementation()!;
  request.mockImplementation(async (path: string, options?: RequestInit) =>
    path === "/installation/turnstile/accounts"
      ? {
          accounts: [
            { id: account, name: "Account A" },
            { id: "b".repeat(32), name: "Account B" },
          ],
        }
      : provider(path, options),
  );
  render(<TurnstileSetup />);
  fireEvent.change(screen.getByLabelText("Cloudflare API Token"), {
    target: { value: "isolated-token" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "自动创建并保存验证配置" }),
  );
  await screen.findByText(/请选择要安装 Turnstile/);
  expect(
    screen.getByRole("button", { name: "自动创建并保存验证配置" }),
  ).toBeDisabled();
  expect(
    request.mock.calls.some(([path]) => path === "/installation/turnstile"),
  ).toBe(false);
});

it("ignores a discovery result after leaving the configuration page", async () => {
  let resolve!: (value: unknown) => void;
  request.mockImplementation(async (path: string) =>
    path === "/installation/config"
      ? { settings: {}, turnstileSecretSet: false }
      : new Promise((value) => {
          resolve = value;
        }),
  );
  const view = render(<TurnstileSetup />);
  fireEvent.change(screen.getByLabelText("Cloudflare API Token"), {
    target: { value: "isolated-token" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "自动创建并保存验证配置" }),
  );
  view.unmount();
  await act(async () =>
    resolve({ accounts: [{ id: account, name: "Late account" }] }),
  );
  expect(screen.queryByText("Late account")).not.toBeInTheDocument();
});
it("allows automatic repair when a URL was previously stored as the Site Key", async () => {
  request.mockResolvedValue({
    settings: { turnstileSiteKey: "http://85.155.115.98:8088" },
    turnstileSecretSet: true,
  });
  render(<TurnstileSetup />);
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(screen.getByLabelText("Cloudflare API Token")).toBeInTheDocument();
  expect(screen.queryByText("Turnstile 已配置。")).not.toBeInTheDocument();
});
