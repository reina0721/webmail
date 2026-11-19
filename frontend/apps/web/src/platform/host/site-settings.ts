import { createAppStore } from "@community-go/state-foundation";
import {
  DEFAULT_SITE_METADATA,
  mergeSiteMetadata,
  writeCachedSiteMetadata,
  type SiteMetadata,
} from "@/native/site-defaults";

export const useSiteSettings = createAppStore<{
  brand: string;
  domain: string;
  metadata: SiteMetadata;
  setSite: (site: { brand: string; domain: string }) => void;
  setMetadata: (metadata: SiteMetadata) => void;
}>((set) => ({
  brand: DEFAULT_SITE_METADATA.brand,
  domain: "",
  metadata: DEFAULT_SITE_METADATA,
  setSite: (site) =>
    set((state) => {
      const nextBrand = site.brand.trim() || state.metadata.brand;
      const nextMetadata =
        nextBrand === state.metadata.brand
          ? state.metadata
          : mergeSiteMetadata({ ...state.metadata, brand: nextBrand });
      return {
        brand: nextBrand,
        domain: site.domain,
        metadata: nextMetadata,
      };
    }),
  setMetadata: (raw) =>
    set(() => {
      const metadata = mergeSiteMetadata(raw);
      writeCachedSiteMetadata(metadata);
      return { brand: metadata.brand, metadata };
    }),
}));
