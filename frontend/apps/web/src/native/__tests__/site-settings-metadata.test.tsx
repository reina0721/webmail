import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSiteSettings } from "@platform/host/site-settings";
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

import { Auth } from "../auth";
import { SiteMetadataSettings } from "../site-metadata-settings";

beforeEach(() => {
  request.mockReset();
  useSiteSettings.getState().setMetadata(DEFAULT_SITE_METADATA);
});

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
    expect(sanitizeCssUrl('javascript:alert(1)')).toBe(
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
    expect(container.querySelector(".auth-backdrop")).toBeInTheDocument();
    expect(screen.getByText("今晚 23:00 进行例行维护。")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "登录到极光邮箱" }),
    ).toBeInTheDocument();
    expect(screen.getByText("© 2026 Aurora Mail")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "注册" }));
    expect(
      await screen.findByRole("heading", { name: "注册极光账号" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "找回密码" }));
    expect(
      await screen.findByRole("heading", { name: "找回极光密码" }),
    ).toBeInTheDocument();
  });

  it("loads, uploads auth background asset, and saves site metadata settings", async () => {
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/site" && !init?.method) {
        return DEFAULT_SITE_METADATA;
      }
      if (path === "/admin/site/assets/auth-background" && init?.method === "POST") {
        return {
          kind: "auth-background",
          url: "/api/v1/site/assets/auth-background?v=deadbeef1234",
        };
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
