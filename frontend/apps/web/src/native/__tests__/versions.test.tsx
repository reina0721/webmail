import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { components } from "@platform/lib/generated-api";
import { Versions } from "../versions";

const request = vi.hoisted(() => vi.fn());
vi.mock("@platform/lib/api", async (original) => ({
  ...(await original<object>()),
  api: request,
}));

const version = "v0.4.0-alpha.15";
const snapshot = { id: "a".repeat(32), version, createdAt: 42 };
const inventory = (
  count: number,
  overrides: Partial<components["schemas"]["DeploymentView"]> = {},
) => ({
  version,
  architecture: "linux/amd64",
  revision: "a".repeat(40),
  managerOnline: true,
  inventory: {
    historicalSwitch: true,
    releasesStatus: "ready",
    snapshots: [],
    releases: Array.from({ length: count }, (_, index) => ({
      version: `v0.4.0-alpha.${count - index}`,
      prerelease: true,
      historical: count - index < 15,
      unavailableReason: count - index === 2 ? "missing_platform_bundle" : null,
    })),
  },
  ...overrides,
});

beforeEach(() => request.mockReset());

it.each([26, 200])(
  "keeps the %i releases in the picker until opened and supports keyboard selection",
  async (count) => {
    request.mockResolvedValue(inventory(count));
    render(<Versions />);
    const field = await screen.findByRole("combobox", { name: "选择版本" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("v0.4.0-alpha.4")).not.toBeInTheDocument();
    fireEvent.focus(field);
    expect(await screen.findAllByRole("option")).toHaveLength(count);
    fireEvent.change(field, { target: { value: ".4" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("v0.4.0-alpha.4");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "准备安装旧版" }));
    const dialog = await screen.findByRole("dialog", { name: "安装历史版本" });
    expect(dialog).toHaveTextContent("v0.4.0-alpha.4");
    expect(dialog).toHaveTextContent("全新的本地数据");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(
      request.mock.calls.every(([path]) => path === "/admin/deployment"),
    ).toBe(true);
  },
);

it("allows browsing while offline and explains permission and release limitations", async () => {
  request.mockResolvedValue(
    inventory(26, {
      managerOnline: false,
      managerIssue: "permission_denied",
    }),
  );
  render(<Versions />);
  const field = await screen.findByRole("combobox", { name: "选择版本" });
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "v0.4.0-alpha.2" } });
  expect(
    screen.getByRole("option", {
      name: /alpha\.2 预发布 · 缺少本机架构的安装包$/,
    }),
  ).toHaveAttribute("aria-disabled", "true");
  fireEvent.change(field, { target: { value: "v0.4.0-alpha.4" } });
  fireEvent.click(screen.getByRole("option", { name: /alpha\.4/ }));
  expect(screen.getByRole("button", { name: "准备安装旧版" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "容器无法访问管理套接字",
  );
});

it("offers recovery only when there is a local snapshot and opens its confirmation", async () => {
  const view = inventory(26);
  request.mockResolvedValue({
    ...view,
    inventory: { ...view.inventory, snapshots: [snapshot] },
  });
  render(<Versions />);
  fireEvent.mouseDown(
    await screen.findByRole("combobox", { name: "选择本机快照" }),
  );
  fireEvent.click(
    await screen.findByRole("option", { name: /v0\.4\.0-alpha\.15/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "恢复快照" }));
  expect(
    await screen.findByRole("dialog", { name: "恢复版本快照" }),
  ).toHaveTextContent("数据库和配置");
});

it("keeps the search text while the selected release is refreshed in the background", async () => {
  vi.useFakeTimers();
  try {
    request.mockImplementation(async () => inventory(26));
    await act(async () => {
      render(<Versions />);
    });
    const field = screen.getByRole("combobox", { name: "选择版本" });
    act(() => field.focus());
    fireEvent.change(field, { target: { value: ".4" } });
    fireEvent.click(screen.getByRole("option", { name: /alpha\.4/ }));
    fireEvent.change(field, { target: { value: ".2" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(field).toHaveValue(".2");
  } finally {
    vi.useRealTimers();
  }
});
