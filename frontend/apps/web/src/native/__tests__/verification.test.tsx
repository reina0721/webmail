import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@platform/lib/api", async (original) => ({
  ...(await original<object>()),
  api: request,
}));
vi.mock("next/script", () => ({
  default: ({
    onReady,
    onError,
  }: {
    onReady: () => void;
    onError: () => void;
  }) => (
    <>
      <button type="button" onClick={onReady}>
        加载验证脚本
      </button>
      <button type="button" onClick={onError}>
        模拟脚本网络失败
      </button>
    </>
  ),
}));
import { ConsoleVerification } from "../verification";
beforeEach(() => {
  history.replaceState({}, "", "/console/verification/#check=isolated-ticket");
  request
    .mockReset()
    .mockResolvedValue({ siteKey: "owned-site-key", mailSent: false });
  window.turnstile = undefined;
});
it("keeps a saved URL mistake on the verification page with an explicit repair link", async () => {
  request.mockResolvedValue({
    siteKey: "http://85.155.115.98:8088",
    mailSent: false,
  });
  render(<ConsoleVerification />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "不能填写网站地址或 API Token",
  );
  expect(
    screen.getByRole("heading", { name: "验证人机与收信服务" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /返回站点设置修复/ }),
  ).toHaveAttribute("href", "/console/site/#turnstile-setup");
  expect(
    screen.queryByRole("button", { name: "加载验证脚本" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送验证码" })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(1);
});
it("catches synchronous widget errors without crashing or sending mail", async () => {
  window.turnstile = {
    render: vi.fn(() => {
      throw Error("invalid sitekey");
    }),
    remove: vi.fn(),
    reset: vi.fn(),
  };
  render(<ConsoleVerification />);
  fireEvent.click(await screen.findByRole("button", { name: "加载验证脚本" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "人机验证组件加载失败",
  );
  expect(screen.getByLabelText("接收验证码的外部邮箱")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送验证码" })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(1);
});
it("handles asynchronous provider errors and failed cleanup without losing the page", async () => {
  const renderWidget = vi.fn(
    (
      _target: HTMLElement,
      options: Parameters<NonNullable<Window["turnstile"]>["render"]>[1],
    ) => {
      expect(options["error-callback"]?.("110100")).toBe(true);
      return "failed-widget";
    },
  );
  window.turnstile = {
    render: renderWidget,
    remove: vi.fn(() => {
      throw Error("already removed");
    }),
    reset: vi.fn(),
  };
  const view = render(<ConsoleVerification />);
  fireEvent.click(await screen.findByRole("button", { name: "加载验证脚本" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "此时尚未发送验证码",
  );
  await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
  expect(() => view.unmount()).not.toThrow();
});
it("reports blocked or unavailable Turnstile scripts in the form", async () => {
  render(<ConsoleVerification />);
  fireEvent.click(
    await screen.findByRole("button", { name: "模拟脚本网络失败" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("网络连接");
  expect(screen.getByRole("button", { name: "发送验证码" })).toBeDisabled();
});
