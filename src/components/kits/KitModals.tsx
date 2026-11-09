import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FileJson,
  Globe,
  History,
  RefreshCw,
  Upload,
} from "lucide-react";
import Modal from "../shared/Modal";
import useAppStore from "../../stores/appStore";
import { kitsApi, sharedKitsApi, type SharedKitDetailEntry } from "../../utils/api";
import type { KitDetailItem, KitSummaryItem } from "../../stores/useKitStore";

type CollisionChoice = "update" | "copy" | "replace";

interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: Record<string, unknown>;
}

/* ============================================================================
 * Export Kit Modal (Mode 1 `.toolbox-kit.json` & Mode 2 `.toolbox-backup.zip`)
 * ========================================================================== */
export function ExportKitModal({
  kit,
  open,
  onClose,
}: {
  kit: KitSummaryItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const addToast = useAppStore((s) => s.addToast);
  const [mode, setMode] = useState<"kit" | "backup">("kit");
  const [includeGuideNotes, setIncludeGuideNotes] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("kit");
      setIncludeGuideNotes(false);
    }
  }, [open]);

  if (!kit) return null;

  const handleExport = async () => {
    setBusy(true);
    try {
      const { filename } = await kitsApi.downloadExport(kit.id, {
        mode,
        includeGuideNotes,
      });
      addToast({
        type: "success",
        message: `Exported ${filename}`,
      });
      onClose();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Export failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Export "${kit.name}"`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={busy}
          >
            <Download size={16} />
            {busy
              ? "Preparing…"
              : mode === "backup"
                ? "Download .toolbox-backup.zip"
                : "Download .toolbox-kit.json"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setMode("kit")}
          className={`w-full text-left rounded-xl border p-4 transition ${
            mode === "kit"
              ? "border-primary bg-primary/12 text-on-surface"
              : "border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container"
          }`}
        >
          <div className="flex items-start gap-3">
            <FileJson
              size={20}
              className={
                mode === "kit" ? "text-on-primary-wash mt-0.5" : "text-on-surface-variant mt-0.5"
              }
            />
            <div className="flex-1">
              <div className="font-semibold text-sm">
                Shareable Curriculum Kit (<code>.toolbox-kit.json</code>)
              </div>
              <p className="text-xs text-on-surface-variant mt-1">
                Clean curriculum blueprint, knowledge graph, and starter cards/drills.
                Strips personal FSRS review schedules, chat logs, and private files.
              </p>
            </div>
          </div>
        </button>

        {mode === "kit" && (
          <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-container text-xs text-on-surface cursor-pointer">
            <input
              type="checkbox"
              checked={includeGuideNotes}
              onChange={(e) => setIncludeGuideNotes(e.target.checked)}
            />
            <span>Include my Guide notes as baseline curriculum content</span>
          </label>
        )}

        <button
          type="button"
          onClick={() => setMode("backup")}
          className={`w-full text-left rounded-xl border p-4 transition ${
            mode === "backup"
              ? "border-primary bg-primary/12 text-on-surface"
              : "border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container"
          }`}
        >
          <div className="flex items-start gap-3">
            <Archive
              size={20}
              className={
                mode === "backup" ? "text-on-primary-wash mt-0.5" : "text-on-surface-variant mt-0.5"
              }
            />
            <div className="flex-1">
              <div className="font-semibold text-sm">
                Full Personal Backup (<code>.toolbox-backup.zip</code>)
              </div>
              <p className="text-xs text-on-surface-variant mt-1">
                Complete archive including SM-2/FSRS flashcard schedules, review
                history, Guide notes, chat sessions, canvas boards, drills, and
                uploaded source files.
              </p>
            </div>
          </div>
        </button>
      </div>
    </Modal>
  );
}

/* ============================================================================
 * Publish to Shared Community Library Modal
 * ========================================================================== */
export function PublishKitModal({
  kit,
  open,
  onClose,
  onPublished,
}: {
  kit: KitSummaryItem | null;
  open: boolean;
  onClose: () => void;
  onPublished?: () => void;
}) {
  const addToast = useAppStore((s) => s.addToast);
  const [changelog, setChangelog] = useState("");
  const [includeBaselineNotes, setIncludeBaselineNotes] = useState(false);
  const [slugOverride, setSlugOverride] = useState("");
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && kit) {
      setChangelog("");
      setIncludeBaselineNotes(false);
      setSlugOverride(kit.upstreamSlug || kit.slug);
      setConflictHint(null);
    }
  }, [open, kit]);

  if (!kit) return null;

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setConflictHint(null);
    try {
      const res = await kitsApi.publish(kit.id, {
        changelog: changelog.trim() || undefined,
        includeBaselineNotes,
        slug: slugOverride.trim() || undefined,
      });
      const shared = res?.sharedKit;
      addToast({
        type: "success",
        message: `Published "${shared?.name || kit.name}" (v${shared?.latestVersion ?? 1}) to Shared Library`,
      });
      onPublished?.();
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      const suggested =
        typeof apiErr?.details?.suggestedSlug === "string"
          ? apiErr.details.suggestedSlug
          : null;
      if (
        (apiErr.code === "SHARED_KIT_NOT_OWNER" || apiErr.status === 403) &&
        suggested
      ) {
        setSlugOverride(suggested);
        setConflictHint(
          `That Shared Library slug belongs to another author. Suggested fork slug "${suggested}" has been pre-filled — click Publish again to publish your edition.`,
        );
      } else {
        addToast({
          type: "error",
          message: apiErr.message || "Publish failed",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Publish "${kit.name}"`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handlePublish}
            disabled={busy}
          >
            <Globe size={16} />
            {busy ? "Publishing…" : "Publish to Shared Library"}
          </button>
        </div>
      }
    >
      <form onSubmit={handlePublish} className="space-y-4">
        <p className="text-xs text-on-surface-variant">
          Publishing shares the curriculum skeleton and starter decks/drills on this
          server&apos;s Shared Community Library. Your personal SRS schedules, chat
          history, and private files are never shared.
        </p>

        {conflictHint && (
          <div className="rounded-lg border border-outline-variant bg-surface-container-high p-3 text-xs text-on-surface flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{conflictHint}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-on-surface mb-1">
            Shared Library Slug
          </label>
          <input
            type="text"
            className="input w-full"
            value={slugOverride}
            onChange={(e) => setSlugOverride(e.target.value)}
            placeholder={kit.slug}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface mb-1">
            Version Changelog
          </label>
          <textarea
            className="input w-full"
            rows={3}
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            placeholder="What's new or improved in this release?"
          />
        </div>

        <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-container text-xs text-on-surface cursor-pointer">
          <input
            type="checkbox"
            checked={includeBaselineNotes}
            onChange={(e) => setIncludeBaselineNotes(e.target.checked)}
          />
          <span>Include my Guide notes as baseline curriculum content</span>
        </label>
      </form>
    </Modal>
  );
}

/* ============================================================================
 * Import Kit / Backup Modal + Collision Resolution Dialog
 * ========================================================================== */
export function ImportKitModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: (kit: KitDetailItem) => void;
}) {
  const addToast = useAppStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedJson, setParsedJson] = useState<unknown>(null);
  const [isZip, setIsZip] = useState(false);
  const [conflictSlug, setConflictSlug] = useState<string | null>(null);
  const [collisionChoice, setCollisionChoice] =
    useState<CollisionChoice>("update");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedFile(null);
      setParsedJson(null);
      setIsZip(false);
      setConflictSlug(null);
      setCollisionChoice("update");
      setErrorMsg(null);
    }
  }, [open]);

  const handleFileChosen = async (file: File | null) => {
    setErrorMsg(null);
    setConflictSlug(null);
    if (!file) {
      setSelectedFile(null);
      setParsedJson(null);
      return;
    }
    setSelectedFile(file);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      setIsZip(true);
      setParsedJson(null);
      setCollisionChoice("copy");
      return;
    }
    setIsZip(false);
    setCollisionChoice("update");
    try {
      const text = await file.text();
      setParsedJson(JSON.parse(text));
    } catch {
      setErrorMsg("Invalid JSON file. Choose a valid .toolbox-kit.json or .toolbox-backup.zip.");
      setSelectedFile(null);
    }
  };

  const executeImport = async (policy: "error" | CollisionChoice) => {
    if (!selectedFile) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = isZip
        ? await kitsApi.importBackupZip(selectedFile, policy)
        : await kitsApi.importKitJson(parsedJson, policy);
      const importedKit = res?.kit as KitDetailItem | undefined;
      addToast({
        type: "success",
        message: `Imported "${importedKit?.name || selectedFile.name}" (${res?.mode || "done"})`,
      });
      if (importedKit) onImported?.(importedKit);
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 409 || apiErr.code === "KIT_SLUG_CONFLICT") {
        const slug =
          typeof apiErr.details?.slug === "string"
            ? apiErr.details.slug
            : "existing kit";
        setConflictSlug(slug);
      } else {
        setErrorMsg(apiErr.message || "Import failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={conflictSlug ? "Resolve Kit Conflict" : "Import Study Kit or Backup"}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {conflictSlug ? (
            <button
              className="btn btn-primary"
              onClick={() => executeImport(collisionChoice)}
              disabled={busy}
            >
              <CheckCircle2 size={16} />
              {busy ? "Applying…" : "Confirm & Import"}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => executeImport("error")}
              disabled={busy || !selectedFile || Boolean(errorMsg)}
            >
              <Upload size={16} />
              {busy ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      }
    >
      {!conflictSlug ? (
        <div className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0] ?? null;
              void handleFileChosen(f);
            }}
            className="rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low hover:bg-surface-container p-6 text-center cursor-pointer transition"
          >
            <Upload size={26} className="mx-auto text-on-surface-variant mb-2" />
            <p className="text-sm font-medium text-on-surface">
              {selectedFile
                ? selectedFile.name
                : "Drop a .toolbox-kit.json or .toolbox-backup.zip here"}
            </p>
            <p className="text-xs text-on-surface-variant mt-1">
              Click to browse files • Mode 1 curriculum JSON or Mode 2 full backup ZIP
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.zip,application/json,application/zip"
              className="hidden"
              onChange={(e) => void handleFileChosen(e.target.files?.[0] ?? null)}
            />
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-outline-variant bg-surface-container-high p-3 text-xs text-on-surface flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-on-surface-variant">
            You already have a Kit at slug <code>{conflictSlug}</code>. Choose how to
            proceed:
          </p>

          {(
            [
              {
                id: "update" as const,
                title: "Update Curriculum Preserving My Progress",
                desc: "Merges new pillars, topics, starter cards, and drills idempotently while keeping 100% of your FSRS schedules, edits, and notes.",
              },
              {
                id: "copy" as const,
                title: "Import as Separate Copy",
                desc: `Creates an independent Kit under a new slug (e.g. ${conflictSlug}-2) without touching your existing Kit.`,
              },
              {
                id: "replace" as const,
                title: "Replace Existing Kit",
                desc: "Deletes your existing Kit at this slug and replaces it cleanly with the imported file.",
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setCollisionChoice(opt.id)}
              className={`w-full text-left rounded-xl border p-3.5 transition ${
                collisionChoice === opt.id
                  ? "border-primary bg-primary/12 text-on-surface"
                  : "border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container"
              }`}
            >
              <div className="font-semibold text-sm">{opt.title}</div>
              <p className="text-xs text-on-surface-variant mt-1">{opt.desc}</p>
            </button>
          ))}

          {errorMsg && (
            <div className="rounded-lg border border-outline-variant bg-surface-container-high p-3 text-xs text-on-surface">
              {errorMsg}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ============================================================================
 * Shared Kit Changelog & Details Modal
 * ========================================================================== */
export function SharedKitChangelogModal({
  slug,
  open,
  onClose,
}: {
  slug: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SharedKitDetailEntry | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !slug) return;
    let cancelled = false;
    setLoading(true);
    sharedKitsApi
      .get(slug)
      .then((res) => {
        if (!cancelled) setDetail(res?.sharedKit ?? null);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slug]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={detail ? `${detail.icon} ${detail.name} — Releases` : "Version History"}
      footer={
        <div className="flex justify-end">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="py-6 text-center text-xs text-on-surface-variant flex items-center justify-center gap-2">
          <RefreshCw size={14} className="animate-spin" /> Loading release history…
        </div>
      ) : !detail ? (
        <p className="text-xs text-on-surface-variant">Release notes unavailable.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-on-surface-variant">{detail.description}</p>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {detail.versions.map((ver) => (
              <div
                key={ver.version}
                className="rounded-lg border border-outline-variant bg-surface-container-low p-3"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-on-surface">
                  <span className="inline-flex items-center gap-1.5">
                    <History size={13} /> v{ver.version}
                  </span>
                  <span className="text-on-surface-variant font-normal">
                    {ver.createdAt?.slice(0, 10)}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">
                  {ver.changelog || "Curriculum release"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
