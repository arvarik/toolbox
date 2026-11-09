import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Eye,
  Lightbulb,
  Loader2,
  Lock,
  Play,
  Sparkles,
} from "lucide-react";
import MarkdownRenderer from "../shared/MarkdownRenderer";
import RubricFeedbackCard from "./RubricFeedbackCard.tsx";
import useAppStore from "../../stores/appStore";
import {
  drillsApi,
  type DrillItem,
  type DrillSubmitResult,
} from "../../utils/pedagogyApi.ts";

const READ_GATE_SECONDS = 20;
const MIN_ATTEMPT_CHARS = 30;

const DIFFICULTY_META: Record<1 | 2 | 3, { label: string; badge: string }> = {
  1: {
    label: "Level 1 · Foundational",
    badge: "bg-info/10 text-info border-info/30",
  },
  2: {
    label: "Level 2 · Multi-Constraint",
    badge: "bg-primary/15 text-on-primary-wash border-primary/30",
  },
  3: {
    label: "Level 3 · Adversarial",
    badge: "bg-warning/15 text-warning border-warning/30",
  },
};

export interface GuidedDrillWorkspaceProps {
  drill: DrillItem;
  onAttemptRecorded?: (result: DrillSubmitResult) => void;
  onVariantCreated?: (newDrill: DrillItem) => void;
}

export default function GuidedDrillWorkspace({
  drill,
  onAttemptRecorded,
  onVariantCreated,
}: GuidedDrillWorkspaceProps) {
  const model = useAppStore((s) => s.model);
  const addToast = useAppStore((s) => s.addToast);

  const [submission, setSubmission] = useState("");
  const [hintsUsed, setHintsUsed] = useState<0 | 1 | 2 | 3>(0);
  const [viewedWorkedSolution, setViewedWorkedSolution] = useState(false);
  const [showPostGradeSolution, setShowPostGradeSolution] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(READ_GATE_SECONDS);
  const [submitting, setSubmitting] = useState(false);
  const [generatingVariant, setGeneratingVariant] = useState(false);
  const [result, setResult] = useState<DrillSubmitResult | null>(null);

  // Reset attempt state whenever drill changes
  useEffect(() => {
    setSubmission("");
    setHintsUsed(0);
    setViewedWorkedSolution(false);
    setShowPostGradeSolution(false);
    setSecondsLeft(READ_GATE_SECONDS);
    setResult(null);
  }, [drill.id]);

  // 20-second read countdown timer for Hint 1 unlock
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft, drill.id]);

  const nonWhitespaceChars = submission.replace(/\s+/g, "").length;
  const hint1Unlocked = nonWhitespaceChars >= MIN_ATTEMPT_CHARS || secondsLeft === 0;
  const isAssistedLive = hintsUsed >= 3 || viewedWorkedSolution;

  const handleRevealHint = (tier: 1 | 2 | 3) => {
    if (tier === 1 && !hint1Unlocked) return;
    if (tier === 2 && hintsUsed < 1) return;
    if (tier === 3 && hintsUsed < 2) return;
    if (tier > hintsUsed) {
      setHintsUsed(tier);
    }
  };

  const handleRevealWorkedSolution = () => {
    if (result) {
      setShowPostGradeSolution((v) => !v);
      return;
    }
    setViewedWorkedSolution(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submission.trim()) {
      addToast({
        type: "error",
        message: "Write your solution in the scratchpad before submitting.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const graded = await drillsApi.submit(drill.id, {
        submission: submission.trim(),
        hintsUsed,
        viewedWorkedSolution,
        model,
      });
      setResult(graded);
      useAppStore.getState().bumpSrsVersion();
      if (graded.masteryEligible) {
        useAppStore.getState().triggerAhaMoment();
      }
      onAttemptRecorded?.(graded);
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to grade drill.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateVariant = async () => {
    setGeneratingVariant(true);
    try {
      const fresh = await drillsApi.generate({
        nodeId: drill.nodeId,
        difficulty: drill.difficulty,
        model,
      });
      addToast({
        type: "success",
        message: `Generated fresh unassisted variant for ${drill.nodeName}`,
      });
      onVariantCreated?.(fresh);
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Could not generate variant.",
      });
    } finally {
      setGeneratingVariant(false);
    }
  };

  const diffMeta = DIFFICULTY_META[drill.difficulty] ?? DIFFICULTY_META[2];

  return (
    <div
      data-testid="guided-drill-workspace"
      className="space-y-5"
    >
      {/* Drill Scenario Card */}
      <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${diffMeta.badge}`}
            >
              {diffMeta.label}
            </span>
            <span className="text-xs font-semibold text-on-surface-variant">
              Concept: <strong className="text-on-surface">{drill.nodeName}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {drill.mastered && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-success/15 text-success border border-success/30 inline-flex items-center gap-1">
                <CheckCircle2 size={12} />
                Mastered
              </span>
            )}
            {isAssistedLive && (
              <span
                data-testid="live-assisted-pill"
                className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-warning/15 text-warning border border-warning/35 inline-flex items-center gap-1"
              >
                <AlertTriangle size={12} />
                Assisted Mode
              </span>
            )}
          </div>
        </div>

        <div
          data-testid="drill-prompt-markdown"
          className="text-sm text-on-surface leading-relaxed"
        >
          <MarkdownRenderer content={drill.prompt} />
        </div>

        {/* Progressive Attempt-Gated Hints */}
        <div className="pt-3 border-t border-outline-variant space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wide text-on-surface-variant flex items-center gap-1.5">
              <Lightbulb size={14} className="text-warning" />
              Progressive Scaffolding Hints
            </div>
            {!hint1Unlocked && hintsUsed === 0 && (
              <span
                data-testid="hint-1-gate-reason"
                className="text-[11px] text-on-surface-variant"
              >
                Unlocks after {MIN_ATTEMPT_CHARS - nonWhitespaceChars} more
                non-space chars or {secondsLeft}s read time
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Hint 1: Nudge */}
            <button
              type="button"
              data-testid="reveal-hint-1-btn"
              disabled={!hint1Unlocked && hintsUsed < 1}
              onClick={() => handleRevealHint(1)}
              className={`btn btn-sm ${
                hintsUsed >= 1 ? "btn-primary" : "btn-secondary"
              }`}
            >
              {!hint1Unlocked && hintsUsed < 1 ? (
                <Lock size={13} />
              ) : (
                <Lightbulb size={13} />
              )}
              {hintsUsed >= 1
                ? "Hint 1: Nudge ✓"
                : !hint1Unlocked
                  ? `Hint 1: Nudge (${secondsLeft}s / ${nonWhitespaceChars}/${MIN_ATTEMPT_CHARS} chars)`
                  : "Reveal Hint 1 (Nudge)"}
            </button>

            {/* Hint 2: Setup (caps mastery at 80%) */}
            <button
              type="button"
              data-testid="reveal-hint-2-btn"
              disabled={hintsUsed < 1}
              onClick={() => handleRevealHint(2)}
              className={`btn btn-sm ${
                hintsUsed >= 2 ? "btn-primary" : "btn-secondary"
              }`}
              title="Using Hint 2 caps your maximum score at 80%"
            >
              {hintsUsed < 1 ? <Lock size={13} /> : <Lightbulb size={13} />}
              {hintsUsed >= 2
                ? "Hint 2: Setup ✓ (80% cap)"
                : "Hint 2: Setup (caps score at 80%)"}
            </button>

            {/* Hint 3: Key Step (marks Assisted) */}
            <button
              type="button"
              data-testid="reveal-hint-3-btn"
              disabled={hintsUsed < 2}
              onClick={() => handleRevealHint(3)}
              className={`btn btn-sm ${
                hintsUsed >= 3 ? "btn-primary" : "btn-secondary"
              }`}
              title="Using Hint 3 marks this attempt Assisted"
            >
              {hintsUsed < 2 ? <Lock size={13} /> : <AlertTriangle size={13} />}
              {hintsUsed >= 3
                ? "Hint 3: Key Step ✓ (Assisted)"
                : "Hint 3: Key Step (Marks Assisted)"}
            </button>

            {/* Worked Solution */}
            {(drill.workedSolution || result?.workedSolution) && (
              <button
                type="button"
                data-testid="reveal-worked-solution-btn"
                onClick={handleRevealWorkedSolution}
                className="btn btn-ghost btn-sm"
              >
                <Eye size={13} />
                {viewedWorkedSolution || showPostGradeSolution
                  ? result && !viewedWorkedSolution
                    ? "Hide Worked Solution"
                    : "Worked Solution Shown"
                  : result
                    ? "View Reference Solution"
                    : "Worked Solution (Marks Assisted)"}
              </button>
            )}
          </div>

          {/* Revealed Hints Stack */}
          {hintsUsed >= 1 && (
            <div className="space-y-2 pt-1">
              <div
                data-testid="hint-1-box"
                className="rounded-xl border border-outline-variant bg-surface-container p-3 text-xs text-on-surface"
              >
                <div className="font-bold text-on-primary-wash mb-1">
                  Hint 1 · Nudge
                </div>
                <MarkdownRenderer content={drill.hints[0]} />
              </div>

              {hintsUsed >= 2 && (
                <div
                  data-testid="hint-2-box"
                  className="rounded-xl border border-warning/30 bg-surface-container p-3 text-xs text-on-surface"
                >
                  <div className="font-bold text-warning mb-1">
                    Hint 2 · Structural Setup (Score capped at 80%)
                  </div>
                  <MarkdownRenderer content={drill.hints[1]} />
                </div>
              )}

              {hintsUsed >= 3 && (
                <div
                  data-testid="hint-3-box"
                  className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-on-surface"
                >
                  <div className="font-bold text-warning mb-1">
                    Hint 3 · Key Step (Attempt marked Assisted)
                  </div>
                  <MarkdownRenderer content={drill.hints[2]} />
                </div>
              )}
            </div>
          )}

          {/* Worked Solution Display */}
          {(viewedWorkedSolution || showPostGradeSolution) &&
            (result?.workedSolution || drill.workedSolution) && (
              <div
                data-testid="worked-solution-box"
                className="rounded-xl border border-primary/35 bg-surface-container p-4 text-xs text-on-surface space-y-1.5"
              >
                <div className="font-bold text-on-primary-wash flex items-center gap-1.5">
                  <BookOpen size={14} />
                  Reference Worked Solution
                </div>
                <MarkdownRenderer
                  content={result?.workedSolution || drill.workedSolution}
                />
              </div>
            )}
        </div>
      </section>

      {/* Scratchpad & Submission Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="drill-scratchpad"
            className="text-xs font-bold uppercase tracking-wide text-on-surface"
          >
            Solution Scratchpad
          </label>
          <span className="text-[11px] text-on-surface-variant font-mono">
            {nonWhitespaceChars} non-space chars
          </span>
        </div>

        <textarea
          id="drill-scratchpad"
          data-testid="drill-scratchpad"
          className="input w-full min-h-[160px] text-sm"
          placeholder="Reason step by step: state invariants, concrete mechanisms, edge cases, and trade-offs…"
          value={submission}
          onChange={(e) => setSubmission(e.target.value)}
          disabled={submitting}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void handleGenerateVariant()}
            disabled={generatingVariant || submitting}
          >
            {generatingVariant ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            New Variant
          </button>

          <button
            type="submit"
            data-testid="submit-drill-btn"
            className="btn btn-primary"
            disabled={submitting || !submission.trim()}
          >
            {submitting ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Play size={15} />
            )}
            {submitting ? "Evaluating Against Rubric…" : "Submit for Rubric Grading"}
          </button>
        </div>
      </form>

      {/* Anti-Sycophancy Rubric Feedback */}
      {result && (
        <RubricFeedbackCard
          result={result}
          onGenerateUnassistedVariant={() => void handleGenerateVariant()}
          isGeneratingVariant={generatingVariant}
        />
      )}
    </div>
  );
}
