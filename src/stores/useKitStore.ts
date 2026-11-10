import { useMemo } from "react";
import { useLocation } from "react-router";
import { create } from "zustand";
import type {
  KitSkeletonV1,
  Pillar,
  SectionLens,
} from "../../shared/kits/kitSkeleton.ts";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";
import * as apiModule from "../utils/api";

export interface KitSummaryItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  status: string;
  statusDetail: string | null;
  forkedFromSharedId: string | null;
  forkedVersion: number | null;
  upstreamSlug: string | null;
  upstreamLatestVersion: number | null;
  hasUpstreamUpdate: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  pillarCount: number;
  topicCount: number;
  nodeCount: number;
  capabilities: KitSkeletonV1["capabilities"];
  deckCount: number;
  cardCount: number;
  dueCount: number;
  newCount: number;
  reviewedCount: number;
  masteryPercent: number;
  guideFilledCount: number;
  guideTotalCount: number;
  archivedNotesCount: number;
  drillCount: number;
  dogearCount?: number;
  lastGuideRef?: {
    pillarId: string;
    topicId: string;
    sectionId: string;
    pillarName?: string;
    topicName?: string;
    updatedAt?: string;
  } | null;
}

export interface KitDetailItem extends KitSummaryItem {
  skeleton: KitSkeletonV1;
}

interface KitStoreState {
  kits: KitSummaryItem[];
  activeKitSlug: string | null;
  activeKit: KitDetailItem | null;
  kitCache: Record<string, KitDetailItem>;
  isLoadingList: boolean;

  fetchKits: () => Promise<KitSummaryItem[]>;
  selectKitBySlug: (slug: string | null) => Promise<KitDetailItem | null>;
  syncUpstream: (slugOrId: string) => Promise<unknown>;
  setActiveKitDirect: (kit: KitDetailItem | null) => void;
  removeKitFromState: (slugOrId: string) => void;
}

function getKitsApi(): Record<string, (...args: unknown[]) => Promise<unknown>> | null {
  try {
    const mod = apiModule as unknown as {
      kitsApi?: Record<string, (...args: unknown[]) => Promise<unknown>>;
    };
    return mod?.kitsApi ?? null;
  } catch {
    return null;
  }
}

export function extractKitSlugFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/k\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function syncGlobalActiveSlug(slug: string | null): void {
  (globalThis as Record<string, unknown>).__toolboxActiveKitSlug = slug;
}

export const useKitStore = create<KitStoreState>((set, get) => ({
  kits: [],
  activeKitSlug: null,
  activeKit: null,
  kitCache: {},
  isLoadingList: false,

  fetchKits: async () => {
    const kitsApi = getKitsApi();
    if (!kitsApi?.list) return get().kits;
    set({ isLoadingList: true });
    try {
      const res = (await kitsApi.list()) as { kits?: KitSummaryItem[] } | null;
      const list = Array.isArray(res?.kits) ? res.kits : [];
      set({ kits: list });
      return list;
    } catch {
      return get().kits;
    } finally {
      set({ isLoadingList: false });
    }
  },

  selectKitBySlug: async (slug: string | null) => {
    if (!slug) {
      if (get().activeKitSlug !== null || get().activeKit !== null) {
        set({ activeKitSlug: null, activeKit: null });
      }
      return null;
    }

    const cached = get().kitCache[slug];
    set(cached ? { activeKitSlug: slug, activeKit: cached } : { activeKitSlug: slug });

    const kitsApi = getKitsApi();
    if (!kitsApi?.get) return cached ?? null;

    try {
      const res = (await kitsApi.get(slug)) as { kit?: KitDetailItem } | null;
      const kit = res?.kit ?? null;
      if (kit) {
        set((state) => ({
          activeKitSlug: kit.slug,
          activeKit: kit,
          kitCache: { ...state.kitCache, [kit.slug]: kit },
          kits: state.kits.some((k) => k.id === kit.id)
            ? state.kits.map((k) => (k.id === kit.id ? kit : k))
            : [kit, ...state.kits],
        }));
        kitsApi.touch?.(kit.id).catch(() => {});
      }
      return kit;
    } catch {
      return cached ?? null;
    }
  },

  syncUpstream: async (slugOrId: string) => {
    const kitsApi = getKitsApi();
    if (!kitsApi?.syncUpstream) return null;
    const res = (await kitsApi.syncUpstream(slugOrId)) as {
      kit?: KitDetailItem;
    } | null;
    if (res?.kit) {
      const updated = res.kit;
      set((state) => ({
        activeKit:
          state.activeKit?.id === updated.id ||
          state.activeKitSlug === updated.slug
            ? updated
            : state.activeKit,
        kitCache: { ...state.kitCache, [updated.slug]: updated },
        kits: state.kits.map((k) => (k.id === updated.id ? updated : k)),
      }));
    }
    return res;
  },

  setActiveKitDirect: (kit: KitDetailItem | null) => {
    if (!kit) {
      set({ activeKitSlug: null, activeKit: null });
      return;
    }
    set((state) => ({
      activeKitSlug: kit.slug,
      activeKit: kit,
      kitCache: { ...state.kitCache, [kit.slug]: kit },
    }));
  },

  removeKitFromState: (slugOrId: string) => {
    set((state) => {
      const target = state.kits.find(
        (k) => k.id === slugOrId || k.slug === slugOrId,
      );
      const nextCache = { ...state.kitCache };
      if (target) delete nextCache[target.slug];
      delete nextCache[slugOrId];
      const clearingActive =
        state.activeKit?.id === slugOrId ||
        state.activeKit?.slug === slugOrId ||
        state.activeKitSlug === slugOrId;
      return {
        kits: state.kits.filter((k) => k.id !== slugOrId && k.slug !== slugOrId),
        kitCache: nextCache,
        activeKitSlug: clearingActive ? null : state.activeKitSlug,
        activeKit: clearingActive ? null : state.activeKit,
      };
    });
  },
}));

useKitStore.subscribe((state) => {
  syncGlobalActiveSlug(state.activeKitSlug);
});

/**
 * Used synchronously to attach `X-Toolbox-Kit` on every API call.
 */
export function getActiveKitSlugForRequest(): string | null {
  if (typeof window !== "undefined" && window.location?.pathname) {
    const fromUrl = extractKitSlugFromPathname(window.location.pathname);
    if (fromUrl) return fromUrl;
  }
  try {
    return useKitStore.getState().activeKitSlug;
  } catch {
    return null;
  }
}

export function buildSectionsByPillar(
  pillars: readonly Pillar[],
): Record<string, SectionLens[]> {
  const map: Record<string, SectionLens[]> = {};
  for (const p of pillars) {
    map[p.id] = p.sections;
  }
  return map;
}

export interface ActiveKitView {
  kit: KitDetailItem | null;
  kitId: string | null;
  kitSlug: string | null;
  skeleton: KitSkeletonV1;
  pillars: Pillar[];
  sectionsByPillar: Record<string, SectionLens[]>;
  graph: KitSkeletonV1["graph"];
  capabilities: KitSkeletonV1["capabilities"];
  tutor: KitSkeletonV1["tutor"];
  canvasConfig: KitSkeletonV1["canvasConfig"];
}

/**
 * Router-safe active Kit hook: falls back cleanly to `SYSTEM_DESIGN_KIT_SKELETON`
 * whenever no kit is active or when `kitsApi` is mocked out in legacy unit tests.
 */
export function useActiveKit(): ActiveKitView {
  const activeKit = useKitStore((s) => s.activeKit);
  const skeleton = activeKit?.skeleton ?? SYSTEM_DESIGN_KIT_SKELETON;

  const sectionsByPillar = useMemo(
    () => buildSectionsByPillar(skeleton.pillars),
    [skeleton.pillars],
  );

  return {
    kit: activeKit,
    kitId: activeKit?.id ?? null,
    kitSlug: activeKit?.slug ?? null,
    skeleton,
    pillars: skeleton.pillars,
    sectionsByPillar,
    graph: skeleton.graph,
    capabilities: skeleton.capabilities,
    tutor: skeleton.tutor,
    canvasConfig: skeleton.canvasConfig,
  };
}

/**
 * Returns `"/k/<slug>"` when inside a `/k/:slug/*` workspace route, or `""` on legacy top-level routes.
 */
export function useKitRoutePrefix(): string {
  const location = useLocation();
  const slug = extractKitSlugFromPathname(location.pathname);
  return slug ? `/k/${encodeURIComponent(slug)}` : "";
}

export default useKitStore;
