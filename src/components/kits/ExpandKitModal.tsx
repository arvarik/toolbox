import React, { useEffect, useRef, useState } from "react";
import {
  FileText,
  Globe,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Modal from "../shared/Modal";
import useAppStore from "../../stores/appStore";
import type { KitSummaryItem } from "../../stores/useKitStore";
import {
  compilerApi,
  type ExpandKitResponse,
  type StagedSourceSummary,
} from "../../utils/compilerApi";

export function ExpandKitModal({
  kit,
  open,
  onClose,
  onExpanded,
}: {
  kit: KitSummaryItem | null;
  open: boolean;
  onClose: () => void;
  onExpanded?: (res: ExpandKitResponse) => void;
}) {
  const addToast = useAppStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [prompt, setPrompt] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [enableWebResearch, setEnableWebResearch] = useState(false);
  const [stagedSources, setStagedSources] = useState<StagedSourceSummary[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPrompt("");
      setUrlInput("");
      setEnableWebResearch(false);
      setStagedSources([]);
      setErrorMsg(null);
    }
  }, [open, kit?.id]);

  if (!kit) return null;

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setIngesting(true);
    setErrorMsg(null);
    try {
      const res = await compilerApi.uploadSources(files);
      setStagedSources((prev) => [...prev, ...res.sources]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to upload reference file",
      );
    } finally {
      setIngesting(false);
    }
  };

  const handleAddUrl = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setIngesting(true);
    setErrorMsg(null);
    try {
      const res = await compilerApi.ingestUrlOrText({ url: trimmed });
      setStagedSources((prev) => [...prev, ...res.sources]);
      setUrlInput("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to ingest URL");
    } finally {
      setIngesting(false);
    }
  };

  const handleRemoveSource = async (stagedId: string) => {
    setStagedSources((prev) => prev.filter((s) => s.stagedId !== stagedId));
    await compilerApi.deleteSource(stagedId).catch(() => {});
  };

  const handleExpand = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setErrorMsg("Describe the new topics, paper, or module to add.");
      return;
    }

    setExpanding(true);
    setErrorMsg(null);
    try {
      const res = await compilerApi.expandKit(kit.id, {
        prompt: cleanPrompt,
        stagedSourceIds: stagedSources.map((s) => s.stagedId),
        enableWebResearch,
      });

      addToast({
        type: "success",
        message: `Expanded "${kit.name}" (+${res.addedNodeIds.length} concepts — seeding cards in background)`,
      });
      onExpanded?.(res);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Kit expansion failed");
    } finally {
      setExpanding(false);
    }
  };

  const busy = ingesting || expanding;

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={`Expand "${kit.name}"`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="expand-kit-submit-btn"
            onClick={() => void handleExpand()}
            disabled={busy || !prompt.trim()}
          >
            {expanding ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                Expanding DAG…
              </>
            ) : (
              <>
                <Sparkles size={15} />
                Expand Study Kit
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-3 flex items-start gap-2.5">
          <ShieldCheck
            size={17}
            className="text-success shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-xs text-on-surface-variant leading-relaxed">
            <strong className="text-on-surface">Zero-Data-Loss Living Kit:</strong>{" "}
            New Pillars, Topics, and Concept Nodes link cleanly into your existing
            prerequisite DAG while preserving 100% of your flashcards, FSRS review
            history, drills, and Guide notes.
          </p>
        </div>

        <div>
          <label
            htmlFor="expand-kit-prompt-input"
            className="block text-xs font-semibold text-on-surface mb-1.5"
          >
            What would you like to add?
          </label>
          <textarea
            id="expand-kit-prompt-input"
            data-testid="expand-kit-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            placeholder="e.g. Add a deep-dive Pillar on Raft log compaction, snapshotting, and dynamic cluster membership changes."
            className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary"
          />
        </div>

        {/* Optional new source files / URL */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-on-surface">
              Optional Reference Material (.pdf, .md, .txt, or URL)
            </span>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
                multiple
                className="hidden"
                data-testid="expand-kit-file-input"
                onChange={(e) => void handleFilesSelected(e)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} />
                {ingesting ? "Ingesting…" : "Attach PDF / Notes"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Link2
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
              />
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={busy}
                placeholder="https://example.org/spec-or-paper"
                className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-8 pr-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary"
              />
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy || !urlInput.trim()}
              onClick={() => void handleAddUrl()}
            >
              <Plus size={14} />
              Add URL
            </button>
          </div>

          {stagedSources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {stagedSources.map((src) => (
                <span
                  key={src.stagedId}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container px-2.5 py-1 text-xs text-on-surface"
                >
                  <FileText size={12} className="text-primary shrink-0" />
                  <span className="truncate max-w-[180px]">{src.title}</span>
                  <span className="text-on-surface-variant">
                    ({src.wordCount}w)
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${src.title}`}
                    disabled={busy}
                    onClick={() => void handleRemoveSource(src.stagedId)}
                    className="text-on-surface-variant hover:text-on-surface ml-0.5"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Web research toggle */}
        <label className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant bg-surface-container-low p-3 cursor-pointer">
          <div className="flex items-center gap-2.5">
            <Globe size={16} className="text-primary shrink-0" />
            <div>
              <div className="text-xs font-semibold text-on-surface">
                Live Web Research Grounding
              </div>
              <div className="text-xs text-on-surface-variant">
                Search technical documentation & papers to ground new concepts.
              </div>
            </div>
          </div>
          <input
            type="checkbox"
            checked={enableWebResearch}
            disabled={busy}
            onChange={(e) => setEnableWebResearch(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
        </label>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger/12 px-3 py-2 text-xs text-danger"
          >
            {errorMsg}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default ExpandKitModal;
