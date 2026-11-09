import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Calendar,
  Download,
  Flame,
  Globe,
  Layers,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import StudyHeatmapRaw from "../components/study/StudyHeatmap";
import ModalRaw from "../components/shared/Modal";
import {
  ExportKitModal,
  ImportKitModal,
  PublishKitModal,
} from "../components/kits/KitModals";
import { ExpandKitModal } from "../components/kits/ExpandKitModal";
import useAppStore from "../stores/appStore";
import useKitStore, { type KitSummaryItem } from "../stores/useKitStore";
import { kitsApi, sharedKitsApi, studySessionsApi } from "../utils/api";

const StudyHeatmap = StudyHeatmapRaw as unknown as React.ComponentType<{
  sessions: Array<{ date: string; count: number }>;
}>;

const Modal = ModalRaw as unknown as React.ComponentType<{
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}>;

export default function LibraryHomePage() {
  const navigate = useNavigate();
  const addToast = useAppStore((s) => s.addToast);
  const kits = useKitStore((s) => s.kits);
  const isLoadingList = useKitStore((s) => s.isLoadingList);
  const fetchKits = useKitStore((s) => s.fetchKits);
  const syncUpstream = useKitStore((s) => s.syncUpstream);
  const removeKitFromState = useKitStore((s) => s.removeKitFromState);

  const [sessions, setSessions] = useState<Array<{ date: string; count: number }>>([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [forkingStarter, setForkingStarter] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState<KitSummaryItem | null>(null);
  const [publishTarget, setPublishTarget] = useState<KitSummaryItem | null>(null);
  const [expandTarget, setExpandTarget] = useState<KitSummaryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KitSummaryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const hasSeedingKit = useMemo(
    () => kits.some((k) => k.status === "seeding"),
    [kits],
  );

  const loadLibrary = useCallback(async () => {
    await fetchKits();
    if (studySessionsApi?.list) {
      studySessionsApi
        .list()
        .then((rows) => {
          if (Array.isArray(rows)) setSessions(rows);
        })
        .catch(() => {});
    }
  }, [fetchKits]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (!hasSeedingKit) return undefined;
    const timer = window.setInterval(() => {
      void fetchKits();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasSeedingKit, fetchKits]);

  const totals = useMemo(() => {
    let due = 0;
    let cards = 0;
    let avgMasterySum = 0;
    for (const k of kits) {
      due += k.dueCount || 0;
      cards += k.cardCount || 0;
      avgMasterySum += k.masteryPercent || 0;
    }
    const avgMastery = kits.length > 0 ? Math.round(avgMasterySum / kits.length) : 0;
    return { due, cards, avgMastery };
  }, [kits]);

  const handleSyncUpstream = async (kit: KitSummaryItem) => {
    setSyncingId(kit.id);
    try {
      const res = (await syncUpstream(kit.id)) as {
        addedCards?: number;
        addedDrills?: number;
        archivedNotesCount?: number;
      } | null;
      addToast({
        type: "success",
        message: `Updated "${kit.name}" to v${kit.upstreamLatestVersion ?? ""}${
          res?.addedCards ? ` (+${res.addedCards} starter cards)` : ""
        }`,
      });
      await fetchKits();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to sync update",
      });
    } finally {
      setSyncingId(null);
    }
  };

  const handleForkStarter = async () => {
    setForkingStarter(true);
    try {
      const res = await sharedKitsApi.fork("system-design");
      const slug = res?.kit?.slug || "system-design";
      await fetchKits();
      addToast({
        type: "success",
        message: "Added Official System Design Kit to your library",
      });
      navigate(`/k/${encodeURIComponent(slug)}`);
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not add starter kit",
      });
    } finally {
      setForkingStarter(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await kitsApi.delete(deleteTarget.id);
      removeKitFromState(deleteTarget.id);
      addToast({
        type: "info",
        message: `Removed "${deleteTarget.name}" from your library`,
      });
      setDeleteTarget(null);
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Delete failed",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface tracking-tight flex items-center gap-2.5">
            <Layers size={24} className="text-primary" />
            My Study Library
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Isolated domain Study Kits with unified daily spaced-repetition triage.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setImportOpen(true)}
          >
            <Upload size={16} />
            Import Kit / Backup
          </button>
          <Link to="/shared" className="btn btn-ghost">
            <Globe size={16} />
            Shared Library
          </Link>
          <Link
            to="/new"
            className="btn btn-primary"
            data-testid="create-kit-btn"
          >
            <Sparkles size={16} />
            Create Kit
          </Link>
        </div>
      </div>

      {/* Cross-Kit Daily SRS Triage Bar */}
      <section
        aria-label="Daily SRS Triage"
        className="rounded-2xl border border-outline-variant bg-surface-container-low p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-primary/12 text-on-primary-wash flex items-center justify-center shrink-0">
              <Flame size={22} />
            </div>
            <div>
              <div className="text-sm font-semibold text-on-surface">
                Cross-Kit Daily Review Queue
              </div>
              <div className="text-xs text-on-surface-variant mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <strong className="text-on-surface">{totals.due}</strong> due now
                </span>
                <span>•</span>
                <span>
                  <strong className="text-on-surface">{totals.cards}</strong> total cards across{" "}
                  <strong className="text-on-surface">{kits.length}</strong>{" "}
                  {kits.length === 1 ? "Kit" : "Kits"}
                </span>
                {kits.length > 0 && (
                  <>
                    <span>•</span>
                    <span>
                      Avg mastery{" "}
                      <strong className="text-on-surface">{totals.avgMastery}%</strong>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowHeatmap((v) => !v)}
            >
              <Calendar size={15} />
              {showHeatmap ? "Hide Activity" : "Activity Heatmap"}
            </button>
            <Link
              to={totals.due > 0 ? "/review" : "/interleaved"}
              className="btn btn-primary"
              data-testid="cross-kit-review-btn"
            >
              <Activity size={16} />
              {totals.due > 0
                ? `Review ${totals.due} Due Cards`
                : "Interleaved Practice"}
            </Link>
          </div>
        </div>

        {showHeatmap && (
          <div className="pt-2 border-t border-outline-variant">
            <StudyHeatmap sessions={sessions} />
          </div>
        )}
      </section>

      {/* Personal Kits Grid or Empty Onboarding */}
      {isLoadingList && kits.length === 0 ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-10 text-center text-sm text-on-surface-variant flex items-center justify-center gap-2">
          <RefreshCw size={16} className="animate-spin" /> Loading your Study Kits…
        </div>
      ) : kits.length === 0 ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-8 sm:p-10 text-center max-w-2xl mx-auto space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/12 text-on-primary-wash flex items-center justify-center mx-auto">
            <Sparkles size={24} />
          </div>
          <h2 className="text-lg font-semibold text-on-surface">
            Your Personal Study Library is Empty
          </h2>
          <p className="text-sm text-on-surface-variant">
            Add the official <strong>System Design</strong> curriculum in one click,
            explore community-shared Kits, or import a{" "}
            <code>.toolbox-kit.json</code> / <code>.toolbox-backup.zip</code> archive.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              to="/new"
              className="btn btn-primary"
              data-testid="empty-create-kit-btn"
            >
              <Sparkles size={16} />
              Create Custom Kit
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleForkStarter}
              disabled={forkingStarter}
            >
              <BookOpen size={16} />
              {forkingStarter ? "Adding…" : "Add System Design Kit"}
            </button>
            <Link to="/shared" className="btn btn-ghost">
              <Globe size={16} />
              Browse Shared Kits
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setImportOpen(true)}
            >
              <Upload size={16} />
              Import File
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kits.map((kit) => {
            const guidePct =
              kit.guideTotalCount > 0
                ? Math.round((kit.guideFilledCount / kit.guideTotalCount) * 100)
                : 0;
            return (
              <article
                key={kit.id}
                data-testid={`kit-card-${kit.slug}`}
                className="rounded-2xl border border-outline-variant bg-surface-container-low hover:bg-surface-container transition flex flex-col justify-between p-5"
              >
                <div className="space-y-3">
                  {/* Top row: Icon + Title + Upstream Update Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 border border-outline-variant bg-surface-container-high"
                        style={
                          kit.color
                            ? { borderLeftWidth: 4, borderLeftColor: kit.color }
                            : undefined
                        }
                        aria-hidden="true"
                      >
                        {kit.icon || "📚"}
                      </span>
                      <div className="min-w-0">
                        <Link
                          to={`/k/${encodeURIComponent(kit.slug)}`}
                          className="font-semibold text-base text-on-surface hover:underline truncate block"
                        >
                          {kit.name}
                        </Link>
                        <div className="text-xs text-on-surface-variant truncate">
                          {kit.pillarCount} pillars • {kit.topicCount} topics
                          {kit.forkedVersion ? ` • v${kit.forkedVersion}` : ""}
                        </div>
                      </div>
                    </div>

                    {kit.dueCount > 0 && (
                      <Link
                        to={`/k/${encodeURIComponent(kit.slug)}/study`}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary/12 text-on-primary-wash shrink-0"
                        title="Review due cards in this Kit"
                      >
                        {kit.dueCount} due
                      </Link>
                    )}
                  </div>

                  {kit.description && (
                    <p className="text-xs text-on-surface-variant line-clamp-2">
                      {kit.description}
                    </p>
                  )}

                  {/* Live Background Seeder Status Pill */}
                  {kit.status === "seeding" && (
                    <div
                      data-testid={`kit-seeding-pill-${kit.slug}`}
                      className="rounded-xl border border-ai/40 bg-ai/12 px-3 py-2 flex items-center gap-2 text-xs font-medium text-on-ai-wash"
                    >
                      <RefreshCw
                        size={13}
                        className="animate-spin shrink-0"
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        {kit.statusDetail || "Seeding starter cards & drills…"}
                      </span>
                    </div>
                  )}

                  {/* Upstream Update Available Banner */}
                  {kit.hasUpstreamUpdate && (
                    <div className="rounded-xl border border-primary/40 bg-primary/12 p-2.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-on-primary-wash">
                        Update v{kit.upstreamLatestVersion} available
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={syncingId === kit.id}
                        onClick={() => void handleSyncUpstream(kit)}
                      >
                        <RefreshCw
                          size={13}
                          className={syncingId === kit.id ? "animate-spin" : ""}
                        />
                        {syncingId === kit.id ? "Syncing…" : "Sync v" + kit.upstreamLatestVersion}
                      </button>
                    </div>
                  )}

                  {/* Progress bars */}
                  <div className="space-y-2 pt-1">
                    <div>
                      <div className="flex justify-between text-xs text-on-surface-variant mb-1">
                        <span>SRS Mastery</span>
                        <span className="font-medium text-on-surface">
                          {kit.masteryPercent}% ({kit.cardCount} cards)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, kit.masteryPercent)}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-on-surface-variant mb-1">
                        <span>Guide Notes</span>
                        <span className="font-medium text-on-surface">
                          {kit.guideFilledCount}/{kit.guideTotalCount} ({guidePct}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                        <div
                          className="h-full bg-primary/70 transition-all"
                          style={{ width: `${Math.min(100, guidePct)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {kit.archivedNotesCount > 0 && (
                    <div className="text-xs text-on-surface-variant">
                      📦 {kit.archivedNotesCount} archived{" "}
                      {kit.archivedNotesCount === 1 ? "note" : "notes"} preserved
                    </div>
                  )}
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-outline-variant">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Expand Kit with new topics or sources"
                      aria-label={`Expand Kit ${kit.name}`}
                      data-testid={`expand-kit-btn-${kit.slug}`}
                      onClick={() => setExpandTarget(kit)}
                    >
                      <Plus size={14} />
                      Expand Kit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      title="Export Kit or Backup"
                      aria-label={`Export ${kit.name}`}
                      onClick={() => setExportTarget(kit)}
                    >
                      <Download size={15} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      title="Publish to Shared Library"
                      aria-label={`Publish ${kit.name}`}
                      onClick={() => setPublishTarget(kit)}
                    >
                      <Globe size={15} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      title="Delete Kit"
                      aria-label={`Delete ${kit.name}`}
                      onClick={() => setDeleteTarget(kit)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <Link
                    to={`/k/${encodeURIComponent(kit.slug)}`}
                    className="btn btn-primary btn-sm"
                  >
                    Open Workspace
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <ImportKitModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(imported) => {
          void fetchKits();
          if (imported?.slug) {
            navigate(`/k/${encodeURIComponent(imported.slug)}`);
          }
        }}
      />

      <ExportKitModal
        kit={exportTarget}
        open={Boolean(exportTarget)}
        onClose={() => setExportTarget(null)}
      />

      <PublishKitModal
        kit={publishTarget}
        open={Boolean(publishTarget)}
        onClose={() => setPublishTarget(null)}
        onPublished={() => void fetchKits()}
      />

      <ExpandKitModal
        kit={expandTarget}
        open={Boolean(expandTarget)}
        onClose={() => setExpandTarget(null)}
        onExpanded={() => void fetchKits()}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={deleteTarget ? `Delete "${deleteTarget.name}"?` : "Delete Kit"}
        footer={
          <div className="flex justify-end gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void handleConfirmDelete()}
              disabled={deleting}
            >
              <Trash2 size={15} />
              {deleting ? "Deleting…" : "Delete Permanently"}
            </button>
          </div>
        }
      >
        <p className="text-xs text-on-surface-variant">
          Deleting this Study Kit removes its personal flashcards, Guide notes,
          canvas boards, drills, and uploaded source files. Tip: export a{" "}
          <code>.toolbox-backup.zip</code> first if you may want to restore it later.
        </p>
      </Modal>
    </div>
  );
}
