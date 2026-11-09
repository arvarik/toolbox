import React, { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  FileText,
  GitBranch,
  Globe,
  Link2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { KitSkeletonV1, Pillar } from "../../shared/kits/kitSkeleton.ts";
import useAppStore from "../stores/appStore";
import useKitStore from "../stores/useKitStore";
import {
  compilerApi,
  type CompilerDepth,
  type ScopeCalibrationResult,
  type StagedSourceSummary,
  type VerifiedSourcePool,
} from "../utils/compilerApi";

type StudioStep = 1 | 2 | 3;

const DEPTH_OPTIONS: Array<{
  id: CompilerDepth;
  label: string;
  badge: string;
  desc: string;
}> = [
  {
    id: "quick",
    label: "Quick",
    badge: "~12–18 concepts",
    desc: "Focused 3–4 pillar overview for fast ramp-up.",
  },
  {
    id: "standard",
    label: "Standard",
    badge: "~24–36 concepts",
    desc: "Balanced 4–6 pillar curriculum with rich prerequisite links.",
  },
  {
    id: "deep",
    label: "Deep Research",
    badge: "~36–55 concepts",
    desc: "5–7 pillars + automated gap-check follow-up web research.",
  },
];

const DEFAULT_LENSES = [
  {
    id: "mental-model",
    name: "Core Mental Model",
    icon: "compass",
    promptHint: "Explain first principles and intuition.",
    ownershipRule: "Core definitions, intuition, and invariants.",
  },
  {
    id: "mechanics-tradeoffs",
    name: "Mechanics & Tradeoffs",
    icon: "sliders",
    promptHint: "Break down internals, failure modes, and tradeoffs.",
    ownershipRule: "Algorithms, complexity, and failure modes.",
  },
];

function slugifyLocal(raw: string, fallback: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

export default function NewKitStudioPage() {
  const navigate = useNavigate();
  const addToast = useAppStore((s) => s.addToast);
  const fetchKits = useKitStore((s) => s.fetchKits);
  const setActiveKitDirect = useKitStore((s) => s.setActiveKitDirect);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<StudioStep>(1);

  // Stage 1 state
  const [topicPrompt, setTopicPrompt] = useState("");
  const [depth, setDepth] = useState<CompilerDepth>("standard");
  const [enableWebResearch, setEnableWebResearch] = useState(true);
  const [stagedSources, setStagedSources] = useState<StagedSourceSummary[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");

  // Stage 2 state
  const [calibration, setCalibration] = useState<ScopeCalibrationResult | null>(
    null,
  );
  const [suggestedTitle, setSuggestedTitle] = useState("");
  const [suggestedIcon, setSuggestedIcon] = useState("📚");
  const [suggestedDescription, setSuggestedDescription] = useState("");
  const [canvasMode, setCanvasMode] = useState<
    "none" | "concept" | "architecture"
  >("concept");
  const [enableCalculator, setEnableCalculator] = useState(false);
  const [calibrationAnswers, setCalibrationAnswers] = useState<
    Record<string, string>
  >({});
  const [customInstructions, setCustomInstructions] = useState("");

  // Stage 3 state
  const [draftSkeleton, setDraftSkeleton] = useState<KitSkeletonV1 | null>(
    null,
  );
  const [verifiedPool, setVerifiedPool] = useState<VerifiedSourcePool>({
    entries: [],
    gapCheckQueries: [],
  });
  const [citedSourceIds, setCitedSourceIds] = useState<string[]>([]);
  const [refineInput, setRefineInput] = useState("");

  // Busy & Error state
  const [ingesting, setIngesting] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [refining, setRefining] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const busy =
    ingesting || calibrating || compiling || refining || committing;

  const prereqsByNodeId = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!draftSkeleton) return map;
    for (const edge of draftSkeleton.graph.edges) {
      const list = map.get(edge.to) ?? [];
      list.push(edge.from);
      map.set(edge.to, list);
    }
    return map;
  }, [draftSkeleton]);

  /* ── Stage 1 Handlers ─────────────────────────────────────────── */

  const runStudioStep = async (
    setFlag: React.Dispatch<React.SetStateAction<boolean>>,
    fallbackMsg: string,
    fn: () => Promise<void>,
  ) => {
    setFlag(true);
    setErrorMsg(null);
    try {
      await fn();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : fallbackMsg);
    } finally {
      setFlag(false);
    }
  };

  const stagedIds = () => stagedSources.map((s) => s.stagedId);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    await runStudioStep(setIngesting, "File upload failed", async () => {
      const res = await compilerApi.uploadSources(files);
      setStagedSources((prev) => [...prev, ...res.sources]);
    });
  };

  const handleAddUrl = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    await runStudioStep(setIngesting, "Failed to fetch URL", async () => {
      const res = await compilerApi.ingestUrlOrText({ url: trimmed });
      setStagedSources((prev) => [...prev, ...res.sources]);
      setUrlInput("");
    });
  };

  const handleAddPastedNotes = async () => {
    const trimmed = pasteText.trim();
    if (!trimmed) return;
    await runStudioStep(
      setIngesting,
      "Failed to stage pasted text",
      async () => {
        const res = await compilerApi.ingestUrlOrText({
          text: trimmed,
          title: pasteTitle.trim() || "Pasted Syllabus / Notes",
        });
        setStagedSources((prev) => [...prev, ...res.sources]);
        setPasteText("");
        setPasteTitle("");
        setShowPasteBox(false);
      },
    );
  };

  const handleRemoveStaged = async (stagedId: string) => {
    setStagedSources((prev) => prev.filter((s) => s.stagedId !== stagedId));
    await compilerApi.deleteSource(stagedId).catch(() => {});
  };

  const handleCalibrate = async () => {
    if (!topicPrompt.trim()) {
      setErrorMsg("Enter a topic, syllabus, or learning goal to begin.");
      return;
    }
    await runStudioStep(setCalibrating, "Scope calibration failed", async () => {
      const res = await compilerApi.calibrate({
        topicPrompt: topicPrompt.trim(),
        depth,
        stagedSourceIds: stagedIds(),
      });
      setCalibration(res.calibration);
      setSuggestedTitle(res.calibration.suggestedTitle);
      setSuggestedIcon(res.calibration.suggestedIcon || "📚");
      setSuggestedDescription(res.calibration.suggestedDescription);
      setCanvasMode(res.calibration.suggestedCapabilities.canvas);
      setEnableCalculator(res.calibration.suggestedCapabilities.calculator);
      setCalibrationAnswers(
        Object.fromEntries(
          res.calibration.dimensions.map((d) => [d.label, d.recommended]),
        ),
      );
      setStep(2);
    });
  };

  /* ── Stage 2 -> Stage 3 Compile Handler ───────────────────────── */

  const handleCompile = async (skipCalibration = false) => {
    if (!topicPrompt.trim()) {
      setErrorMsg("Enter a topic, syllabus, or learning goal to compile.");
      return;
    }
    await runStudioStep(
      setCompiling,
      "Blueprint compilation failed",
      async () => {
        const res = await compilerApi.compile({
          topicPrompt: topicPrompt.trim(),
          depth,
          stagedSourceIds: stagedIds(),
          enableWebResearch,
          ...(skipCalibration
            ? {}
            : {
                suggestedTitle: suggestedTitle.trim() || undefined,
                suggestedIcon: suggestedIcon.trim() || undefined,
                suggestedDescription: suggestedDescription.trim() || undefined,
                suggestedCapabilities: {
                  canvas: canvasMode,
                  calculator: enableCalculator,
                  webResearchDefault: enableWebResearch,
                  enableSvgDiagrams: true,
                },
                calibrationAnswers,
                customInstructions: customInstructions.trim() || undefined,
              }),
        });
        setDraftSkeleton(res.skeleton);
        setVerifiedPool(res.pool);
        setCitedSourceIds(res.citedSourceIds);
        setStep(3);
      },
    );
  };

  /* ── Stage 3 Interactive Blueprint Editing & Chat Refinement ──── */

  const updatePillars = (updater: (pillars: Pillar[]) => Pillar[]) => {
    setDraftSkeleton((prev) => {
      if (!prev) return prev;
      const nextPillars = updater(prev.pillars).map((p, i) => ({
        ...p,
        number: i + 1,
      }));
      const validPillarIds = new Set(nextPillars.map((p) => p.id));
      const nextNodes = prev.graph.nodes.filter((n) =>
        validPillarIds.has(n.pillarId),
      );
      const validNodeIds = new Set(nextNodes.map((n) => n.id));
      const nextEdges = prev.graph.edges.filter(
        (e) => validNodeIds.has(e.from) && validNodeIds.has(e.to),
      );
      return {
        ...prev,
        pillars: nextPillars,
        graph: {
          ...prev.graph,
          nodes: nextNodes,
          edges: nextEdges,
        },
      };
    });
  };

  const handleMovePillar = (index: number, delta: -1 | 1) => {
    updatePillars((pillars) => {
      const target = index + delta;
      if (target < 0 || target >= pillars.length) return pillars;
      const copy = [...pillars];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy;
    });
  };

  const handleRenamePillar = (pillarId: string, name: string) => {
    updatePillars((pillars) =>
      pillars.map((p) =>
        p.id === pillarId
          ? { ...p, name, shortName: name.slice(0, 36) || p.shortName }
          : p,
      ),
    );
  };

  const handleRemovePillar = (pillarId: string) => {
    updatePillars((pillars) =>
      pillars.length <= 1 ? pillars : pillars.filter((p) => p.id !== pillarId),
    );
  };

  const handleAddPillar = () => {
    if (!draftSkeleton) return;
    const nextNum = draftSkeleton.pillars.length + 1;
    const pillarId = slugifyLocal(
      `pillar-${nextNum}-${Date.now().toString(36).slice(-4)}`,
      `pillar-${nextNum}`,
    );
    const topicId = `${pillarId}-core`;
    const nodeId = `${pillarId}-concept`;

    setDraftSkeleton((prev) => {
      if (!prev) return prev;
      const newPillar: Pillar = {
        id: pillarId,
        number: prev.pillars.length + 1,
        name: `New Pillar ${prev.pillars.length + 1}`,
        shortName: `Pillar ${prev.pillars.length + 1}`,
        color: "#006a91",
        sections: prev.pillars[0]?.sections ?? DEFAULT_LENSES,
        topics: [{ id: topicId, name: "Core Concepts" }],
      };
      return {
        ...prev,
        pillars: [...prev.pillars, newPillar],
        graph: {
          ...prev.graph,
          nodes: [
            ...prev.graph.nodes,
            {
              id: nodeId,
              name: "Core Concepts",
              pillarId,
              topicId,
              summary: "Core principles and mental models for this pillar.",
              keywords: ["core"],
              components: [],
            },
          ],
        },
      };
    });
  };

  const handleRenameTopic = (
    pillarId: string,
    topicId: string,
    name: string,
  ) => {
    updatePillars((pillars) =>
      pillars.map((p) =>
        p.id !== pillarId
          ? p
          : {
              ...p,
              topics: p.topics.map((t) =>
                t.id === topicId ? { ...t, name } : t,
              ),
            },
      ),
    );
  };

  const handleAddTopic = (pillarId: string) => {
    setDraftSkeleton((prev) => {
      if (!prev) return prev;
      const targetPillar = prev.pillars.find((p) => p.id === pillarId);
      if (!targetPillar) return prev;
      const idx = targetPillar.topics.length + 1;
      const topicId = `${pillarId}-topic-${idx}-${Date.now().toString(36).slice(-3)}`;
      const nodeId = `${topicId}-concept`;
      return {
        ...prev,
        pillars: prev.pillars.map((p) =>
          p.id !== pillarId
            ? p
            : {
                ...p,
                topics: [...p.topics, { id: topicId, name: `New Topic ${idx}` }],
              },
        ),
        graph: {
          ...prev.graph,
          nodes: [
            ...prev.graph.nodes,
            {
              id: nodeId,
              name: `New Topic ${idx}`,
              pillarId,
              topicId,
              summary: `Core concepts of New Topic ${idx}.`,
              keywords: [`topic-${idx}`],
              components: [],
            },
          ],
        },
      };
    });
  };

  const handleRemoveTopic = (pillarId: string, topicId: string) => {
    setDraftSkeleton((prev) => {
      if (!prev) return prev;
      const pillar = prev.pillars.find((p) => p.id === pillarId);
      if (!pillar || pillar.topics.length <= 1) return prev;
      const fallbackTopicId =
        pillar.topics.find((t) => t.id !== topicId)?.id ?? null;
      return {
        ...prev,
        pillars: prev.pillars.map((p) =>
          p.id !== pillarId
            ? p
            : { ...p, topics: p.topics.filter((t) => t.id !== topicId) },
        ),
        graph: {
          ...prev.graph,
          nodes: prev.graph.nodes.map((n) =>
            n.pillarId === pillarId && n.topicId === topicId
              ? { ...n, topicId: fallbackTopicId }
              : n,
          ),
        },
      };
    });
  };

  const handleChatRefine = async () => {
    if (!draftSkeleton || !refineInput.trim()) return;
    await runStudioStep(setRefining, "Refinement failed", async () => {
      const res = await compilerApi.refine({
        skeleton: draftSkeleton,
        instruction: refineInput.trim(),
        stagedSourceIds: stagedIds(),
        pool: verifiedPool,
      });
      setDraftSkeleton(res.skeleton);
      setCitedSourceIds(res.citedSourceIds);
      setRefineInput("");
      addToast({
        type: "success",
        message: "Blueprint refined and DAG verified",
      });
    });
  };

  /* ── Stage 4 Instant Save ─────────────────────────────────────── */

  const handleCommitKit = async () => {
    if (!draftSkeleton) return;
    setCommitting(true);
    setErrorMsg(null);
    try {
      const res = await compilerApi.commit({
        skeleton: draftSkeleton,
        stagedSourceIds: stagedSources.map((s) => s.stagedId),
      });

      setActiveKitDirect(res.kit);
      void fetchKits();
      addToast({
        type: "success",
        message: `Created "${res.kit.name}" — seeding starter flashcards & drills in the background!`,
      });
      navigate(`/k/${encodeURIComponent(res.kit.slug)}/guide`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to create Study Kit",
      );
      setCommitting(false);
    }
  };

  const totalTopics = draftSkeleton
    ? draftSkeleton.pillars.reduce((acc, p) => acc + p.topics.length, 0)
    : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Studio Header & Stepper */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface mb-2"
          >
            <ArrowLeft size={14} />
            Back to My Library
          </Link>
          <h1 className="text-2xl font-bold text-on-surface tracking-tight flex items-center gap-2.5">
            <Sparkles size={24} className="text-primary" />
            Deep Research Kit Studio
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Compile grounded, cycle-verified Study Kits from any topic, PDF,
            syllabus, or technical URL.
          </p>
        </div>

        {/* Step Indicator */}
        <ol
          aria-label="Compiler Progress"
          className="flex items-center gap-2 text-xs font-medium"
        >
          {[
            { num: 1, label: "Sources & Topic" },
            { num: 2, label: "Calibrate Scope" },
            { num: 3, label: "Blueprint & DAG" },
          ].map((s) => {
            const active = step === s.num;
            const done = step > s.num;
            return (
              <li
                key={s.num}
                className={`px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${
                  active
                    ? "border-primary bg-primary/15 text-on-primary-wash font-semibold"
                    : done
                      ? "border-outline-variant bg-surface-container text-on-surface"
                      : "border-outline-variant bg-surface-container-low text-on-surface-variant"
                }`}
              >
                {done ? (
                  <CheckCircle2 size={13} className="text-success" />
                ) : (
                  <span>{s.num}.</span>
                )}
                <span>{s.label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/12 px-4 py-3 text-sm text-danger flex items-center justify-between gap-3"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setErrorMsg(null)}
            className="text-danger hover:opacity-80"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════
          STAGE 1: TOPIC, DEPTH & SOURCE INGESTION
         ═════════════════════════════════════════════════════════════ */}
      {step === 1 && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 sm:p-6 space-y-5">
            <div>
              <label
                htmlFor="studio-topic-prompt"
                className="block text-sm font-semibold text-on-surface mb-2"
              >
                What do you want to master?
              </label>
              <textarea
                id="studio-topic-prompt"
                data-testid="studio-topic-input"
                rows={4}
                value={topicPrompt}
                onChange={(e) => setTopicPrompt(e.target.value)}
                disabled={busy}
                placeholder="e.g. Distributed Consensus & Storage Engines (Raft, Paxos, MVCC, LSM-Trees vs B-Trees, Jepsen failure modes)..."
                className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary"
              />
            </div>

            {/* Depth Selector */}
            <div>
              <div className="text-xs font-semibold text-on-surface mb-2">
                Curriculum Depth
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {DEPTH_OPTIONS.map((opt) => {
                  const selected = depth === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`depth-option-${opt.id}`}
                      aria-pressed={selected}
                      disabled={busy}
                      onClick={() => setDepth(opt.id)}
                      className={`text-left rounded-xl border p-3.5 transition ${
                        selected
                          ? "border-primary bg-primary/12 text-on-surface"
                          : "border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm">{opt.label}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-1.5">
                        {opt.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Web Research Toggle */}
            <label className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3.5 cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/12 text-on-primary-wash flex items-center justify-center shrink-0">
                  <Globe size={18} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-on-surface">
                    Deep Web Research & Verified Citations
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    Ground concepts in real documentation & papers with zero
                    hallucinated URLs.
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                data-testid="studio-web-research-toggle"
                checked={enableWebResearch}
                disabled={busy}
                onChange={(e) => setEnableWebResearch(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
            </label>
          </section>

          {/* Reference Sources Panel */}
          <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-on-surface">
                  Ground with Your Sources (Optional)
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Upload PDFs (up to 25 MB, worker-isolated extraction),{" "}
                  <code>.md</code> / <code>.txt</code> notes, or reference URLs.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
                  multiple
                  className="hidden"
                  data-testid="studio-file-input"
                  onChange={(e) => void handleFileUpload(e)}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} />
                  {ingesting ? "Ingesting…" : "Upload PDF / MD / TXT"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => setShowPasteBox((v) => !v)}
                >
                  <FileText size={14} />
                  {showPasteBox ? "Hide Paste Box" : "Paste Syllabus"}
                </button>
              </div>
            </div>

            {/* URL Adder */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Link2
                  size={15}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
                />
                <input
                  type="url"
                  data-testid="studio-url-input"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={busy}
                  placeholder="https://raft.github.io/raft.pdf or documentation URL"
                  className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary"
                />
              </div>
              <button
                type="button"
                data-testid="studio-add-url-btn"
                className="btn btn-ghost"
                disabled={busy || !urlInput.trim()}
                onClick={() => void handleAddUrl()}
              >
                <Plus size={15} />
                Add URL
              </button>
            </div>

            {/* Optional Paste Syllabus Box */}
            {showPasteBox && (
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3.5 space-y-2.5">
                <input
                  type="text"
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="Source title (e.g. Course Syllabus / Lecture Notes)"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-1.5 text-xs text-on-surface"
                />
                <textarea
                  rows={4}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste raw markdown, lecture outline, or reading notes..."
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-xs text-on-surface"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy || !pasteText.trim()}
                    onClick={() => void handleAddPastedNotes()}
                  >
                    Stage Notes
                  </button>
                </div>
              </div>
            )}

            {/* Staged Sources Chips */}
            {stagedSources.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="text-xs font-medium text-on-surface-variant">
                  Staged Sources ({stagedSources.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {stagedSources.map((src, idx) => (
                    <div
                      key={src.stagedId}
                      data-testid={`staged-source-${idx}`}
                      className="rounded-xl border border-outline-variant bg-surface-container-lowest p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-on-surface truncate">
                          [S{idx + 1}] {src.title}
                        </div>
                        <div className="text-[11px] text-on-surface-variant">
                          {src.kind.toUpperCase()} •{" "}
                          {src.wordCount.toLocaleString()} words
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${src.title}`}
                        disabled={busy}
                        onClick={() => void handleRemoveStaged(src.stagedId)}
                        className="btn btn-ghost btn-icon btn-sm shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Stage 1 Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              data-testid="studio-skip-calibrate-btn"
              className="btn btn-ghost"
              disabled={busy || !topicPrompt.trim()}
              onClick={() => void handleCompile(true)}
            >
              {compiling ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  Compiling Blueprint…
                </>
              ) : (
                "Skip Calibration & Compile"
              )}
            </button>

            <button
              type="button"
              data-testid="studio-calibrate-btn"
              className="btn btn-primary"
              disabled={busy || !topicPrompt.trim()}
              onClick={() => void handleCalibrate()}
            >
              {calibrating ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Analyzing Scope…
                </>
              ) : (
                <>
                  Calibrate Scope
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════
          STAGE 2: 3-CHIP SCOPE CALIBRATION
         ═════════════════════════════════════════════════════════════ */}
      {step === 2 && calibration && (
        <div className="space-y-6">
          {/* Suggested Kit Identity & Capabilities */}
          <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 sm:p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[80px_1fr] gap-3">
              <div>
                <label
                  htmlFor="studio-kit-icon"
                  className="block text-xs font-semibold text-on-surface mb-1"
                >
                  Icon
                </label>
                <input
                  id="studio-kit-icon"
                  type="text"
                  maxLength={8}
                  value={suggestedIcon}
                  onChange={(e) => setSuggestedIcon(e.target.value)}
                  className="w-full text-center rounded-xl border border-outline-variant bg-surface-container-lowest px-2 py-2 text-lg text-on-surface"
                />
              </div>
              <div>
                <label
                  htmlFor="studio-kit-title"
                  className="block text-xs font-semibold text-on-surface mb-1"
                >
                  Study Kit Title
                </label>
                <input
                  id="studio-kit-title"
                  data-testid="studio-suggested-title"
                  type="text"
                  value={suggestedTitle}
                  onChange={(e) => setSuggestedTitle(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm font-semibold text-on-surface"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="studio-kit-desc"
                className="block text-xs font-semibold text-on-surface mb-1"
              >
                Description
              </label>
              <input
                id="studio-kit-desc"
                type="text"
                value={suggestedDescription}
                onChange={(e) => setSuggestedDescription(e.target.value)}
                className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-xs text-on-surface"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <div className="flex items-center gap-2 text-xs text-on-surface">
                <span className="font-semibold">Visual Canvas:</span>
                {(["none", "concept", "architecture"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCanvasMode(mode)}
                    className={`px-2.5 py-1 rounded-lg border text-xs capitalize ${
                      canvasMode === mode
                        ? "border-primary bg-primary/15 text-on-primary-wash font-semibold"
                        : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-on-surface cursor-pointer ml-auto">
                <input
                  type="checkbox"
                  checked={enableCalculator}
                  onChange={(e) => setEnableCalculator(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Enable Estimation Calculator
              </label>
            </div>
          </section>

          {/* 3-Chip Calibration Dimensions */}
          <section
            aria-label="Scope Calibration Questions"
            className="grid grid-cols-1 gap-4"
          >
            {calibration.dimensions.map((dim) => {
              const chosen =
                calibrationAnswers[dim.label] ?? dim.recommended;
              return (
                <div
                  key={dim.id}
                  data-testid={`calibration-dim-${dim.id}`}
                  className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 space-y-3"
                >
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-on-primary-wash bg-primary/12 px-2 py-0.5 rounded-full">
                      {dim.label}
                    </span>
                    <h3 className="text-sm font-semibold text-on-surface mt-2">
                      {dim.question}
                    </h3>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {dim.options.map((option) => {
                      const active = chosen === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setCalibrationAnswers((prev) => ({
                              ...prev,
                              [dim.label]: option,
                            }))
                          }
                          className={`px-3.5 py-2 rounded-xl border text-xs font-medium transition ${
                            active
                              ? "border-primary bg-primary/15 text-on-primary-wash font-semibold"
                              : "border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container"
                          }`}
                        >
                          {option}
                          {option === dim.recommended && (
                            <span className="ml-1.5 text-[10px] opacity-80">
                              (Recommended)
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>

          {/* Custom Scope Override */}
          <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-5">
            <label
              htmlFor="studio-custom-scope"
              className="block text-xs font-semibold text-on-surface mb-1.5"
            >
              Additional Focus or Custom Overrides (Optional)
            </label>
            <input
              id="studio-custom-scope"
              data-testid="studio-custom-scope-input"
              type="text"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="e.g. Emphasize Rust async implementations and real production postmortems."
              className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/70"
            />
          </section>

          {/* Stage 2 Actions */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => setStep(1)}
            >
              <ArrowLeft size={16} />
              Back
            </button>

            <button
              type="button"
              data-testid="studio-compile-btn"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void handleCompile(false)}
            >
              {compiling ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Compiling 2-Pass Prerequisite DAG…
                </>
              ) : (
                <>
                  <GitBranch size={16} />
                  Compile Blueprint & Prerequisite DAG
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════
          STAGE 3 & 4: INTERACTIVE BLUEPRINT, DAG & INSTANT SAVE
         ═════════════════════════════════════════════════════════════ */}
      {step === 3 && draftSkeleton && (
        <div className="space-y-6" data-testid="studio-blueprint-editor">
          {/* Summary Banner */}
          <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <span className="w-12 h-12 rounded-2xl border border-outline-variant bg-surface-container-high flex items-center justify-center text-2xl shrink-0">
                {draftSkeleton.identity.icon || "📚"}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    aria-label="Study Kit Name"
                    value={draftSkeleton.identity.name}
                    onChange={(e) =>
                      setDraftSkeleton((prev) =>
                        prev
                          ? {
                              ...prev,
                              identity: {
                                ...prev.identity,
                                name: e.target.value,
                              },
                            }
                          : prev,
                      )
                    }
                    className="text-lg font-bold text-on-surface bg-transparent border-b border-transparent hover:border-outline-variant focus:border-primary focus:outline-none"
                  />
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/12 text-on-primary-wash">
                    <ShieldCheck size={13} />
                    Acyclic DAG Verified
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">
                  {draftSkeleton.pillars.length} Pillars • {totalTopics} Topics
                  • {draftSkeleton.graph.nodes.length} Concept Nodes •{" "}
                  {draftSkeleton.graph.edges.length} Prerequisite Edges •{" "}
                  {draftSkeleton.graph.tracks.length} Tracks
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => setStep(calibration ? 2 : 1)}
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <button
                type="button"
                data-testid="studio-commit-btn"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void handleCommitKit()}
              >
                {committing ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Saving Kit…
                  </>
                ) : (
                  <>
                    <BookOpen size={16} />
                    Create Study Kit
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Chat-Refine Bar */}
          <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <input
                type="text"
                data-testid="studio-refine-input"
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleChatRefine();
                  }
                }}
                placeholder="Ask AI to refine the blueprint (e.g. 'Add a pillar on Jepsen testing and split-brain recovery')…"
                className="flex-1 rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                data-testid="studio-refine-btn"
                className="btn btn-ghost"
                disabled={busy || !refineInput.trim()}
                onClick={() => void handleChatRefine()}
              >
                {refining ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" />
                    Refining…
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    Refine Blueprint
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Interactive Pillars, Topics & Concept DAG Nodes */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-on-surface">
                Curriculum Pillars & Prerequisite Concept Graph
              </h2>
              <button
                type="button"
                data-testid="studio-add-pillar-btn"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={handleAddPillar}
              >
                <Plus size={14} />
                Add Pillar
              </button>
            </div>

            {draftSkeleton.pillars.map((pillar, pIndex) => {
              const pillarNodes = draftSkeleton.graph.nodes.filter(
                (n) => n.pillarId === pillar.id,
              );
              return (
                <article
                  key={pillar.id}
                  data-testid={`blueprint-pillar-${pillar.id}`}
                  className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 space-y-4"
                >
                  {/* Pillar Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <span
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-primary/15 text-on-primary-wash shrink-0"
                        style={
                          pillar.color
                            ? { borderLeft: `3px solid ${pillar.color}` }
                            : undefined
                        }
                      >
                        P{pillar.number}
                      </span>
                      <input
                        type="text"
                        aria-label={`Pillar ${pillar.number} name`}
                        value={pillar.name}
                        onChange={(e) =>
                          handleRenamePillar(pillar.id, e.target.value)
                        }
                        className="w-full font-semibold text-sm text-on-surface bg-surface-container-lowest border border-outline-variant rounded-lg px-2.5 py-1.5"
                      />
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label={`Move pillar ${pillar.number} up`}
                        disabled={busy || pIndex === 0}
                        onClick={() => handleMovePillar(pIndex, -1)}
                        className="btn btn-ghost btn-icon btn-sm"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move pillar ${pillar.number} down`}
                        disabled={
                          busy || pIndex === draftSkeleton.pillars.length - 1
                        }
                        onClick={() => handleMovePillar(pIndex, 1)}
                        className="btn btn-ghost btn-icon btn-sm"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove pillar ${pillar.number}`}
                        disabled={busy || draftSkeleton.pillars.length <= 1}
                        onClick={() => handleRemovePillar(pillar.id)}
                        className="btn btn-ghost btn-icon btn-sm"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Section Lenses */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-on-surface-variant font-medium mr-1">
                      Lenses:
                    </span>
                    {pillar.sections.map((sec) => (
                      <span
                        key={sec.id}
                        className="px-2 py-0.5 rounded-md bg-surface-container-high text-on-surface text-[11px]"
                      >
                        {sec.name}
                      </span>
                    ))}
                  </div>

                  {/* Topics Editor */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-on-surface-variant">
                        Topics ({pillar.topics.length})
                      </span>
                      <button
                        type="button"
                        data-testid={`studio-add-topic-${pillar.id}`}
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => handleAddTopic(pillar.id)}
                      >
                        <Plus size={13} />
                        Add Topic
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {pillar.topics.map((topic) => (
                        <div
                          key={topic.id}
                          className="flex items-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5"
                        >
                          <input
                            type="text"
                            aria-label={`Topic ${topic.name}`}
                            value={topic.name}
                            onChange={(e) =>
                              handleRenameTopic(
                                pillar.id,
                                topic.id,
                                e.target.value,
                              )
                            }
                            className="flex-1 bg-transparent text-xs font-medium text-on-surface focus:outline-none"
                          />
                          <button
                            type="button"
                            aria-label={`Remove topic ${topic.name}`}
                            disabled={busy || pillar.topics.length <= 1}
                            onClick={() =>
                              handleRemoveTopic(pillar.id, topic.id)
                            }
                            className="text-on-surface-variant hover:text-on-surface p-0.5"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Concept DAG Nodes Preview */}
                  {pillarNodes.length > 0 && (
                    <div className="pt-2 border-t border-outline-variant space-y-2">
                      <div className="text-xs font-semibold text-on-surface-variant flex items-center gap-1.5">
                        <GitBranch size={13} className="text-primary" />
                        Concept DAG Nodes ({pillarNodes.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {pillarNodes.map((node) => {
                          const prereqs = prereqsByNodeId.get(node.id) ?? [];
                          return (
                            <div
                              key={node.id}
                              className="rounded-xl border border-outline-variant bg-surface-container px-3 py-1.5 text-xs"
                              title={node.summary}
                            >
                              <div className="font-medium text-on-surface">
                                {node.name}
                              </div>
                              {prereqs.length > 0 && (
                                <div className="text-[11px] text-on-surface-variant mt-0.5">
                                  requires: {prereqs.join(", ")}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Grounded Bibliography ([S1]..[Sn]) */}
          {(draftSkeleton.bibliography.length > 0 ||
            verifiedPool.entries.length > 0) && (
            <section
              data-testid="studio-bibliography-section"
              className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 space-y-3"
            >
              <h2 className="text-sm font-semibold text-on-surface">
                Verified Grounding Sources & Bibliography
              </h2>
              <ul className="space-y-2 text-xs">
                {verifiedPool.entries.length > 0
                  ? verifiedPool.entries.map((entry) => {
                      const isCited = citedSourceIds
                        .map((id) => id.toUpperCase())
                        .includes(entry.id.toUpperCase());
                      return (
                        <li
                          key={entry.id}
                          className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="px-2 py-0.5 rounded-md font-mono font-semibold bg-primary/12 text-on-primary-wash">
                              [{entry.id}]
                            </span>
                            {entry.url ? (
                              <a
                                href={entry.url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium text-on-surface hover:underline truncate"
                              >
                                {entry.title}
                              </a>
                            ) : (
                              <span className="font-medium text-on-surface truncate">
                                {entry.title}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-on-surface-variant">
                            {isCited ? "Cited in Blueprint" : entry.kind}
                          </span>
                        </li>
                      );
                    })
                  : draftSkeleton.bibliography.map((item, idx) => (
                      <li
                        key={`${item.title}-${idx}`}
                        className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 flex items-center gap-2"
                      >
                        <span className="px-2 py-0.5 rounded-md font-mono font-semibold bg-primary/12 text-on-primary-wash">
                          [S{idx + 1}]
                        </span>
                        <span className="font-medium text-on-surface">
                          {item.title}
                        </span>
                      </li>
                    ))}
              </ul>
            </section>
          )}

          {/* Bottom Instant Commit CTA */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void handleCommitKit()}
            >
              {committing ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Saving Kit…
                </>
              ) : (
                <>
                  <BookOpen size={16} />
                  Create Study Kit & Open Guide
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
