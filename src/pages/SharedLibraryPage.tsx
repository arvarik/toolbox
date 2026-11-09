import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Globe,
  History,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  SharedKitChangelogModal,
  type SharedKitListEntry,
} from "../components/kits/KitModals";
import useAppStore from "../stores/appStore";
import useKitStore from "../stores/useKitStore";
import { sharedKitsApi } from "../utils/api";

export default function SharedLibraryPage() {
  const navigate = useNavigate();
  const addToast = useAppStore((s) => s.addToast);
  const ownedKits = useKitStore((s) => s.kits);
  const fetchOwnedKits = useKitStore((s) => s.fetchKits);
  const syncUpstream = useKitStore((s) => s.syncUpstream);

  const [sharedKits, setSharedKits] = useState<SharedKitListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [changelogSlug, setChangelogSlug] = useState<string | null>(null);

  const loadShared = useCallback(async () => {
    setLoading(true);
    try {
      const [res] = await Promise.all([
        sharedKitsApi.list(),
        fetchOwnedKits(),
      ]);
      setSharedKits(Array.isArray(res?.kits) ? res.kits : []);
    } catch {
      setSharedKits([]);
    } finally {
      setLoading(false);
    }
  }, [fetchOwnedKits]);

  useEffect(() => {
    void loadShared();
  }, [loadShared]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const k of sharedKits) {
      for (const t of k.tags || []) {
        if (t) set.add(t);
      }
    }
    return Array.from(set).sort();
  }, [sharedKits]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sharedKits.filter((item) => {
      if (activeTag && !(item.tags || []).includes(activeTag)) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        item.slug.toLowerCase().includes(needle) ||
        (item.tags || []).some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [sharedKits, query, activeTag]);

  const ownedBySharedId = useMemo(() => {
    const map = new Map<string, (typeof ownedKits)[number]>();
    for (const k of ownedKits) {
      if (k.forkedFromSharedId) map.set(k.forkedFromSharedId, k);
      map.set(`slug:${k.slug}`, k);
    }
    return map;
  }, [ownedKits]);

  const handleFork = async (item: SharedKitListEntry) => {
    setBusySlug(item.slug);
    try {
      const res = await sharedKitsApi.fork(item.slug);
      await loadShared();
      const targetSlug = res?.kit?.slug || item.slug;
      addToast({
        type: "success",
        message: `Added "${item.name}" to your library`,
      });
      navigate(`/k/${encodeURIComponent(targetSlug)}/guide`);
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not fork Shared Kit",
      });
    } finally {
      setBusySlug(null);
    }
  };

  const handlePullUpdate = async (ownedId: string, item: SharedKitListEntry) => {
    setBusySlug(item.slug);
    try {
      await syncUpstream(ownedId);
      await loadShared();
      addToast({
        type: "success",
        message: `Synced "${item.name}" to v${item.latestVersion}`,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setBusySlug(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="mb-1">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface"
            >
              <ArrowLeft size={14} /> Back to My Library
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-on-surface tracking-tight flex items-center gap-2.5">
            <Globe size={24} className="text-primary" />
            Shared Community Library
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Discover official and peer-published Study Kits on this server. Fork any
            curriculum into your private workspace in one click.
          </p>
        </div>
      </div>

      {/* Search & Tag Filters */}
      <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-4 space-y-3">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search kits by topic, domain, or tag…"
            aria-label="Search shared kits"
            className="input w-full pl-9"
          />
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTag(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                activeTag === null
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container text-on-surface-variant hover:text-on-surface"
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                  activeTag === tag
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container text-on-surface-variant hover:text-on-surface"
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results Grid */}
      {loading ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-10 text-center text-sm text-on-surface-variant flex items-center justify-center gap-2">
          <RefreshCw size={16} className="animate-spin" /> Loading Shared Library…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-10 text-center text-sm text-on-surface-variant">
          No shared Kits match your filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => {
            const owned =
              ownedBySharedId.get(item.id) ??
              ownedBySharedId.get(`slug:${item.slug}`);
            const isBusy = busySlug === item.slug;

            return (
              <article
                key={item.id}
                data-testid={`shared-kit-${item.slug}`}
                className="rounded-2xl border border-outline-variant bg-surface-container-low hover:bg-surface-container transition flex flex-col justify-between p-5"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 border border-outline-variant bg-surface-container-high"
                        style={
                          item.color
                            ? { borderLeftWidth: 4, borderLeftColor: item.color }
                            : undefined
                        }
                        aria-hidden="true"
                      >
                        {item.icon || "📚"}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-base text-on-surface truncate flex items-center gap-1.5">
                          <span className="truncate">{item.name}</span>
                          {item.isOfficial && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/12 text-on-primary-wash shrink-0"
                              title="Official Built-In Kit"
                            >
                              <ShieldCheck size={12} /> Official
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-on-surface-variant truncate">
                          by {item.authorName} •{" "}
                          <Download size={11} className="inline -mt-0.5" />{" "}
                          {item.downloadsCount}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setChangelogSlug(item.slug)}
                      className="px-2 py-1 rounded-lg text-xs font-medium bg-surface-container-high text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1 shrink-0"
                      title="View release changelog"
                    >
                      <History size={12} /> v{item.latestVersion}
                    </button>
                  </div>

                  {item.description && (
                    <p className="text-xs text-on-surface-variant line-clamp-3">
                      {item.description}
                    </p>
                  )}

                  <div className="text-xs text-on-surface-variant flex flex-wrap gap-x-3 gap-y-1">
                    <span>{item.pillarCount} pillars</span>
                    <span>•</span>
                    <span>{item.topicCount} topics</span>
                    <span>•</span>
                    <span>{item.starterCardCount} starter cards</span>
                    {item.starterDrillCount > 0 && (
                      <>
                        <span>•</span>
                        <span>{item.starterDrillCount} drills</span>
                      </>
                    )}
                  </div>

                  {item.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.tags.slice(0, 5).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-md text-[11px] bg-surface-container text-on-surface-variant"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer Action */}
                <div className="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-outline-variant">
                  {owned ? (
                    owned.hasUpstreamUpdate ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm w-full justify-center"
                        disabled={isBusy}
                        onClick={() => void handlePullUpdate(owned.id, item)}
                      >
                        <RefreshCw
                          size={14}
                          className={isBusy ? "animate-spin" : ""}
                        />
                        {isBusy
                          ? "Syncing…"
                          : `Pull v${item.latestVersion} Update`}
                      </button>
                    ) : (
                      <div className="flex items-center justify-between w-full gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
                          <CheckCircle2 size={14} className="text-primary" /> In Library
                        </span>
                        <Link
                          to={`/k/${encodeURIComponent(owned.slug)}/guide`}
                          className="btn btn-ghost btn-sm"
                        >
                          Open <ArrowRight size={14} />
                        </Link>
                      </div>
                    )
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm w-full justify-center"
                      disabled={isBusy}
                      onClick={() => void handleFork(item)}
                    >
                      <Plus size={15} />
                      {isBusy ? "Adding…" : "Add to My Library"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <SharedKitChangelogModal
        slug={changelogSlug}
        open={Boolean(changelogSlug)}
        onClose={() => setChangelogSlug(null)}
      />
    </div>
  );
}
