import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccentPresetPicker,
  ACCENT_PRESETS,
  ConsoleCopyAction,
  ConsoleKeyValueGrid,
  ConsoleSkeleton,
  ConsoleStepBar,
  ContentSwapTransition,
} from "@mail-web/ui";
import { MaterialTheme } from "@mail-web/ui/theme";
import { useAppearanceStore } from "@/stores/native-host-store";

beforeEach(() => {
  useAppearanceStore.setState({ accent: "sakura" });
});

describe("KIRAKIRA accent presets and theme integration", () => {
  it("renders all 6 inline accent presets and notifies selection changes", () => {
    const onChange = vi.fn();
    render(
      <MaterialTheme dark={false} accent="sakura">
        <AccentPresetPicker mode="inline" value="sakura" onChange={onChange} />
      </MaterialTheme>,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(ACCENT_PRESETS.length);
    expect(screen.getByRole("radio", { name: "樱花粉" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByRole("radio", { name: "紫罗兰" }));
    expect(onChange).toHaveBeenCalledWith("violet");
  });

  it("persists accent selection in useAppearanceStore", () => {
    expect(useAppearanceStore.getState().accent).toBe("sakura");
    useAppearanceStore.getState().setAccent("forest");
    expect(useAppearanceStore.getState().accent).toBe("forest");
  });
});

describe("secondary-encapsulated console primitives", () => {
  it("renders keyed ContentSwapTransition container across key changes", () => {
    const { container, rerender } = render(
      <ContentSwapTransition contentKey="tab-a">
        <p>Panel A</p>
      </ContentSwapTransition>,
    );
    expect(screen.getByText("Panel A")).toBeInTheDocument();
    expect(container.querySelector(".content-transition")).toBeInTheDocument();

    rerender(
      <ContentSwapTransition contentKey="tab-b">
        <p>Panel B</p>
      </ContentSwapTransition>,
    );
    expect(screen.getByText("Panel B")).toBeInTheDocument();
  });

  it("shows temporary copied feedback only when onCopy succeeds", async () => {
    const okCopy = vi.fn().mockResolvedValue(true);
    render(
      <ConsoleCopyAction label="复制命令" copiedLabel="已复制" onCopy={okCopy} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制命令" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument(),
    );
    expect(okCopy).toHaveBeenCalledTimes(1);

    const failCopy = vi.fn().mockResolvedValue(false);
    render(
      <ConsoleCopyAction label="复制失败项" copiedLabel="不应成功" onCopy={failCopy} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制失败项" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "不应成功" })).not.toBeInTheDocument();
  });

  it("renders ConsoleSkeleton with status semantics and shimmer bars", () => {
    const { container } = render(
      <ConsoleSkeleton variant="overview" label="加载概览…" />,
    );
    expect(screen.getByRole("status", { name: "加载概览…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelectorAll(".console-skeleton-bar").length).toBeGreaterThan(4);
  });

  it("marks step states and aria-current accurately in ConsoleStepBar", () => {
    render(
      <ConsoleStepBar
        ariaLabel="安装步骤"
        activeIndex={1}
        steps={[{ label: "步骤一" }, { label: "步骤二" }, { label: "步骤三" }]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-state", "done");
    expect(items[1]).toHaveAttribute("data-state", "active");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[2]).toHaveAttribute("data-state", "upcoming");
  });

  it("renders ConsoleKeyValueGrid items and invokes item copy callbacks", async () => {
    const onCopy = vi.fn().mockResolvedValue(true);
    render(
      <ConsoleKeyValueGrid
        items={[
          { id: "key", label: "Site Key", value: "0x4AAAAAAA", mono: true, onCopy },
          { id: "status", label: "状态", value: "正常" },
        ]}
      />,
    );
    expect(screen.getByText("0x4AAAAAAA").tagName).toBe("CODE");
    expect(screen.getByText("正常")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制Site Key" }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1));
  });
});
