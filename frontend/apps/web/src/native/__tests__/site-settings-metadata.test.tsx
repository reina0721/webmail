import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSiteSettings } from "@platform/host/site-settings";
import {
  AUTH_BACKGROUND_MAX_BYTES,
  compressBackgroundImage,
} from "@/lib/auth-background-image";
import {
  DEFAULT_SITE_METADATA,
  mergeSiteMetadata,
  sanitizeCssUrl,
} from "../site-defaults";

const request = vi.hoisted(() => vi.fn());
vi.mock("@platform/lib/api", async (original) => ({
  ...(await original<object>()),
  api: request,
}));
vi.mock("@/lib/auth-background-image", async (original) => ({
  ...(await original<typeof import("@/lib/auth-background-image")>()),
  compressBackgroundImage: vi.fn(),
}));

import { Auth } from "../auth";
import { SiteMetadataSettings } from "../site-metadata-settings";

beforeEach(() => {
  request.mockReset();
  vi.mocked(compressBackgroundImage).mockReset();
  useSiteSettings.getState().setMetadata(DEFAULT_SITE_METADATA);
});

async function renderBackgroundCard() {
  const revoke = vi.fn();
  let urlCount = 0;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return `blob:local-${++urlCount}`;
      }
      static revokeObjectURL = revoke;
    },
  );
  const view = render(<SiteMetadataSettings />);
  const title = await screen.findByText("登录 / 注册 / 找回页面背景图片", {
    selector: "strong",
  });
  const card = title.closest(".console-asset-card")! as HTMLElement;
  const input = card.querySelector<HTMLInputElement>('input[type="file"]')!;
  return { ...view, card: within(card), input, revoke };
}

function backgroundFile(size = 1024) {
  const bytes = new Uint8Array(size);
  bytes.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
    0x44, 0x52,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1024);
  view.setUint32(20, 512);
  bytes.set([0x49, 0x44, 0x41, 0x54], 37);
  return new File([bytes], "background.png", { type: "image/png" });
}

describe("site defaults and auth backdrop", () => {
  it("provides non-empty defaults for all site, icon, seo, and auth fields", () => {
    const merged = mergeSiteMetadata({});
    expect(merged.brand).toBe("Mail Web");
    expect(merged.tagline).not.toBe("");
    expect(merged.footerText).not.toBe("");
    expect(merged.faviconUrl).toBe("/mark.svg");
    expect(merged.appleTouchIconUrl).toBe("/apple-touch-icon.png");
    expect(merged.authBackgroundUrl).toBe("/branding/auth-bg-default.svg");
    expect(merged.seoTitle).not.toBe("");
    expect(merged.seoDescription).not.toBe("");
    expect(merged.seoKeywords).not.toBe("");
    expect(merged.ogImageUrl).toBe("/screenshot-1280x720.png");
    expect(merged.helpUrl).not.toBe("");
    expect(merged.privacyPolicyUrl).not.toBe("");
    expect(merged.imprintUrl).not.toBe("");
  });

  it("sanitizes unsafe CSS background image URLs", () => {
    expect(sanitizeCssUrl("javascript:alert(1)")).toBe(
      DEFAULT_SITE_METADATA.authBackgroundUrl,
    );
    expect(sanitizeCssUrl('https://cdn.example.com/wall.jpg" )')).toBe(
      DEFAULT_SITE_METADATA.authBackgroundUrl,
    );
    expect(sanitizeCssUrl("https://cdn.example.com/wall.webp")).toBe(
      "https://cdn.example.com/wall.webp",
    );
    expect(sanitizeCssUrl("/api/v1/site/assets/auth-background?v=abc")).toBe(
      "/api/v1/site/assets/auth-background?v=abc",
    );
  });

  it("renders configured background, announcement, titles, and footer on login/register/recovery", async () => {
    request.mockImplementation(async (path: string) => {
      if (path === "/registration/domains") {
        return {
          items: [
            {
              id: "default",
              domain: "example.com",
              enabled: true,
              dependenciesReady: true,
            },
          ],
        };
      }
      if (path.startsWith("/registration/policy")) {
        return { enabled: true, siteKey: "", domain: "example.com" };
      }
      throw new Error("Unexpected path: " + path);
    });

    useSiteSettings.getState().setMetadata(
      mergeSiteMetadata({
        brand: "Aurora Mail",
        authLoginTitle: "登录到极光邮箱",
        authRegisterTitle: "注册极光账号",
        authRecoveryTitle: "找回极光密码",
        announcementEnabled: true,
        announcementTone: "warning",
        announcementText: "今晚 23:00 进行例行维护。",
        footerText: "© 2026 Aurora Mail",
      }),
    );

    const { container } = render(<Auth onLogin={() => {}} />);
    const expectBackdrop = () =>
      expect(container.querySelector(".auth-backdrop")).toBeInTheDocument();
    expectBackdrop();
    expect(screen.getByText("今晚 23:00 进行例行维护。")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "登录到极光邮箱" }),
    ).toBeInTheDocument();
    expect(screen.getByText("© 2026 Aurora Mail")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "注册" }));
    expect(
      await screen.findByRole("heading", { name: "注册极光账号" }),
    ).toBeInTheDocument();
    expectBackdrop();

    fireEvent.click(screen.getByRole("tab", { name: "找回密码" }));
    expect(
      await screen.findByRole("heading", { name: "找回极光密码" }),
    ).toBeInTheDocument();
    expectBackdrop();
  });

  it("loads and saves site metadata settings", async () => {
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/site" && !init?.method) {
        return DEFAULT_SITE_METADATA;
      }
      if (path === "/admin/site" && init?.method === "PUT") {
        return JSON.parse(String(init.body));
      }
      throw new Error("Unexpected path: " + path);
    });

    const onBrandSaved = vi.fn();
    render(<SiteMetadataSettings onBrandSaved={onBrandSaved} />);

    const seoInput = await screen.findByRole("textbox", {
      name: "SEO 页面标题（Title）",
    });
    fireEvent.change(seoInput, { target: { value: "Aurora Mail - 企业邮箱" } });

    const saveBtn = screen.getByRole("button", {
      name: "保存站点、图标与 SEO 配置",
    });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/admin/site",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    expect(useSiteSettings.getState().metadata.seoTitle).toBe(
      "Aurora Mail - 企业邮箱",
    );
    expect(onBrandSaved).toHaveBeenCalledWith("Mail Web");
  });
});

describe("authentication background uploads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uploads only the confirmed current preview and retains it after a failed upload", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => pending.promise);
    const pending = Promise.withResolvers<{ kind: string; url: string }>();
    request.mockImplementation((path: string, init?: RequestInit) => {
      if (
        path === "/admin/site/assets/auth-background" &&
        init?.method === "POST"
      )
        return upload(init.body);
      if (path === "/admin/site" && init?.method === "PUT")
        return JSON.parse(String(init.body));
      return DEFAULT_SITE_METADATA;
    });
    const file = backgroundFile(AUTH_BACKGROUND_MAX_BYTES + 1);
    const compressed = new File(["encoded"], "background.webp", {
      type: "image/webp",
    });
    vi.mocked(compressBackgroundImage).mockResolvedValue({
      file: compressed,
      width: 800,
      height: 400,
      sourceDimensions: { width: 1024, height: 512 },
      fits: true,
    });
    const { card, input, revoke } = await renderBackgroundCard();
    fireEvent.change(input, { target: { files: [file] } });
    const mode = await card.findByRole("combobox", { name: "压缩方式" });
    expect(mode).toHaveTextContent("原图上传");
    expect(card.getByRole("button", { name: "确认上传" })).toBeDisabled();
    fireEvent.mouseDown(mode);
    fireEvent.click(await screen.findByRole("option", { name: "手动压缩" }));
    const preview = () => card.getByRole("button", { name: "生成预览" });
    const confirm = () => card.getByRole("button", { name: "确认上传" });
    expect(confirm()).toBeDisabled();
    fireEvent.click(preview());
    expect(
      await card.findByText("压缩预览", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    fireEvent.change(card.getByRole("spinbutton", { name: "最长边（px）" }), {
      target: { value: "800" },
    });
    expect(confirm()).toBeDisabled();
    expect(revoke).toHaveBeenCalledWith("blob:local-2");
    fireEvent.click(preview());
    await waitFor(() => expect(confirm()).toBeEnabled());
    expect(compressBackgroundImage).toHaveBeenLastCalledWith(
      file,
      expect.anything(),
      { mode: "manual", format: "webp", maxSide: 800, quality: 85 },
      expect.any(AbortSignal),
    );
    fireEvent.click(confirm());
    expect(await card.findByRole("alert")).toHaveTextContent("连接失败");
    expect(confirm()).toBeEnabled();
    expect(
      card.getByText("压缩预览", { selector: "strong" }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", { name: "SEO 页面标题（Title）" }),
      { target: { value: "New title" } },
    );
    const save = screen.getByRole("button", {
      name: "保存站点、图标与 SEO 配置",
    });
    expect(save).toBeEnabled();
    fireEvent.click(confirm());
    expect(save).toBeDisabled();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][0].get("file")).toBe(compressed);
    const url = "/api/v1/site/assets/auth-background?v=deadbeef1234";
    pending.resolve({ kind: "auth-background", url });
    await waitFor(() => expect(save).toBeEnabled());
    expect(useSiteSettings.getState().metadata.authBackgroundUrl).toBe(url);
    expect(
      card.getByRole("textbox", {
        name: "资源地址（支持站内路径或 HTTPS URL）",
      }),
    ).toHaveValue(url);
    fireEvent.click(save);
    expect(request).toHaveBeenCalledWith(
      "/admin/site",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining(url),
      }),
    );
  });

  it("releases the original preview on cancel and sends unchanged bytes at the upload limit", async () => {
    request.mockImplementation((path: string) =>
      path === "/admin/site"
        ? DEFAULT_SITE_METADATA
        : {
            kind: "auth-background",
            url: "/api/v1/site/assets/auth-background?v=original",
          },
    );
    const { card, input, revoke } = await renderBackgroundCard();
    const file = backgroundFile(AUTH_BACKGROUND_MAX_BYTES);
    fireEvent.change(input, { target: { files: [file] } });
    expect(await card.findByRole("img", { name: "原图" })).toBeInTheDocument();
    fireEvent.click(card.getByRole("button", { name: "取消" }));
    expect(revoke).toHaveBeenCalledWith("blob:local-1");
    expect(request).not.toHaveBeenCalledWith(
      "/admin/site/assets/auth-background",
      expect.anything(),
    );
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(await card.findByRole("button", { name: "确认上传" }));
    expect(request).toHaveBeenCalledWith(
      "/admin/site/assets/auth-background",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = request.mock.calls.find(
      ([path]) => path === "/admin/site/assets/auth-background",
    )!;
    expect(init.body.get("file")).toBe(file);
    await waitFor(() =>
      expect(
        card.queryByRole("button", { name: "确认上传" }),
      ).not.toBeInTheDocument(),
    );
  });
});
