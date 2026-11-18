import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("@platform/lib/api", async (original) => ({
  ...(await original<object>()),
  api: request,
}));

import { ConsoleSetup } from "../setup";

beforeEach(() => {
  request.mockReset();
});

const grant = {
  ticket: "isolated-grant",
  domains: [{ id: "test", name: "example.net" }],
  cloudflareAccounts: [],
  missingPermissions: [],
};

async function authorizeFixture() {
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Stalwart HTTPS 地址" }),
    {
      target: { value: "https://mail.example.net" },
    },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Stalwart 管理员账号" }),
    {
      target: { value: "bootstrap" },
    },
  );
  fireEvent.change(screen.getByLabelText("Stalwart 管理员密码"), {
    target: { value: "fixture-admin" },
  });
  fireEvent.click(screen.getByRole("button", { name: "验证 Stalwart 权限" }));
}

it("explains a failed SMTP step and requires fresh authorization before applying again", async () => {
  const fail = {
    status: "failed",
    step: "automatic-gateway",
    completed: ["domain"],
    error: "gateway_smtp_unreachable",
  };
  let started = false;
  request.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/installation")
      return { configured: false, needsOperator: true };
    if (path === "/installation/initialize/authorize") return grant;
    if (path === "/installation/initialize/preflight") {
      return { resources: ["此安装的专用邮件身份"] };
    }
    if (path === "/installation/initialize/job" && options?.method === "POST") {
      started = true;
      return { job: { ...fail, status: "running", error: "" } };
    }
    if (path === "/installation/initialize/job")
      return { job: started ? fail : null };
    throw new Error("Unexpected request: " + path);
  });

  render(<ConsoleSetup />);
  await authorizeFixture();
  fireEvent.change(await screen.findByRole("textbox", { name: "运营邮箱" }), {
    target: { value: "operator@example.net" },
  });
  fireEvent.click(screen.getByRole("button", { name: "检查安装配置" }));
  fireEvent.click(await screen.findByRole("button", { name: "应用配置" }));

  expect(
    await screen.findByText(
      /Webmail 无法连接 Stalwart 的 SMTP 端口/,
      {},
      { timeout: 3000 },
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/请重新验证 Stalwart 权限/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "应用配置" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "停止后续步骤" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("gateway_smtp_unreachable"),
  ).not.toBeInTheDocument();
});

it("requires a fresh grant when the administrator changes the Stalwart source", async () => {
  request.mockImplementation(async (path: string) => {
    if (path === "/installation")
      return { configured: false, needsOperator: true };
    if (path === "/installation/initialize/job") return { job: null };
    if (path === "/installation/initialize/authorize") return grant;
    if (path === "/installation/initialize/preflight")
      return { resources: ["旧服务的预检结果"] };
    throw new Error("Unexpected request: " + path);
  });

  render(<ConsoleSetup />);
  await authorizeFixture();
  fireEvent.click(await screen.findByRole("button", { name: "检查安装配置" }));
  expect(
    await screen.findByRole("button", { name: "应用配置" }),
  ).toBeInTheDocument();

  fireEvent.change(
    screen.getByRole("textbox", { name: "Stalwart HTTPS 地址" }),
    {
      target: { value: "https://different.example.net" },
    },
  );
  expect(
    screen.queryByRole("button", { name: "应用配置" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "检查安装配置" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "验证 Stalwart 权限" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Stalwart 管理员密码")).toHaveValue("");
});

it("keeps Account ID visible and uses a Token entered after Stalwart authorization", async () => {
  const id = "a".repeat(32);
  const saved = "https://webmail.example.net";
  request.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/installation")
      return { configured: true, needsOperator: true };
    if (path === "/installation/config") {
      return {
        settings: {
          publicOrigin: saved,
          domain: "example.net",
          stalwartUrl: "https://mail.example.net",
          brand: "Mail",
        },
      };
    }
    if (path === "/installation/initialize/job") return { job: null };
    if (path === "/installation/initialize/authorize") return grant;
    if (path === "/installation/turnstile/accounts") return { accounts: [] };
    if (path === "/installation/initialize/preflight") {
      expect(JSON.parse(String(options?.body))).toMatchObject({
        ticket: grant.ticket,
        cloudflareToken: "fixture-turnstile-token",
        spec: { cloudflareAccount: id, publicOrigin: saved },
      });
      return { resources: ["已核对邮件域名"], turnstile: true };
    }
    throw new Error("Unexpected request: " + path);
  });

  render(<ConsoleSetup />);
  await authorizeFixture();
  const token = screen.getByLabelText("Cloudflare API Token");
  const account = screen.getByLabelText("Cloudflare Account ID");
  fireEvent.change(token, { target: { value: "fixture-turnstile-token" } });
  const check = await screen.findByRole("button", { name: "检查安装配置" });
  fireEvent.click(check);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /选择 Cloudflare 账号或填写 Account ID/,
  );
  fireEvent.change(account, { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "重新读取配置" }));
  expect(await screen.findByText(/已读取已保存的配置/)).toHaveTextContent(
    saved,
  );
  expect(account).toHaveValue(id);
  expect(token).toHaveValue("fixture-turnstile-token");
  fireEvent.click(check);
  expect(
    await screen.findByText(/Cloudflare Turnstile 组件与一对密钥/),
  ).toBeInTheDocument();
  expect(screen.getByText(id)).toBeInTheDocument();
});
