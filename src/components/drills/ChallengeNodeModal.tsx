import React, { useEffect, useState } from "react";
import {
  Award,
  BookCheck,
  Flame,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";
import Modal from "../shared/Modal";
import MarkdownRenderer from "../shared/MarkdownRenderer";
import RubricFeedbackCard from "./RubricFeedbackCard.tsx";
import useAppStore from "../../stores/appStore";
import {
  drillsApi,
  type ChallengeNodePayload,
  type ChallengeSubmitResult,
} from "../../utils/pedagogyApi.ts";

export interface ChallengeNodeModalProps {
  nodeId: string | null;
  nodeName?: string;
  open: boolean;
  onClose: () => void;
  onCompleted?: (result: ChallengeSubmitResult) => void;
}

export default function ChallengeNodeModal({
  nodeId,
  nodeName,
  open,
  onClose,
  onCompleted,
}: ChallengeNodeModalProps) {
  const model = useAppStore((s) => s.model);
  const addToast = useAppStore((s) => s.addToast);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ChallengeNodePayload | null>(null);
  const [drillSubmission, setDrillSubmission] = useState("");
  const [feynmanExplanation, setFeynmanExplanation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ChallengeSubmitResult | null>(null);

  useEffect(() => {
    if (!open || !nodeId) {
      setPayload(null);
      setResult(null);
      setLoadError(null);
      setDrillSubmission("");
      setFeynmanExplanation("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setResult(null);

    drillsApi
      .getChallenge(nodeId, model)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Could not load challenge.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, nodeId, model]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodeId || !payload) return;
    if (!drillSubmission.trim() || !feynmanExplanation.trim()) {
      addToast({
        type: "error",
        message: "Complete both the Hard Drill and the Feynman Synthesis.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await drillsApi.submitChallenge(nodeId, {
        drillId: payload.drill.id,
        drillSubmission: drillSubmission.trim(),
        feynmanExplanation: feynmanExplanation.trim(),
        model,
      });
      setResult(res);

      if (res.pass && res.factualOrLogicalErrors.length === 0) {
        useAppStore.getState().bumpSrsVersion();
        useAppStore.getState().triggerAhaMoment();
        onCompleted?.(res);
      }
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to evaluate challenge.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const challengePassed = Boolean(
    result && result.pass && result.factualOrLogicalErrors.length === 0,
  );

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={`⚡ Challenge Node: ${payload?.nodeName || nodeName || ""}`.trim()}
    >
      <div
        data-testid="challenge-node-modal"
        className="space-y-4 max-h-[75vh] overflow-y-auto pr-1"
      >
        {/* Diagnostic Fast-Track Rules Banner */}
        <div className="rounded-xl border border-primary/35 bg-primary/10 p-3 text-xs text-on-surface flex items-start gap-2.5">
          <Zap size={16} className="text-on-primary-wash shrink-0 mt-0.5" />
          <div>
            <strong>Diagnostic Fast-Track (0 Hints):</strong> Score{" "}
            <strong>≥ 85%</strong> with <strong>zero factual errors</strong> on
            a Hard (Difficulty 3) drill + first-principles Feynman synthesis to
            unlock this concept immediately, graduate its flashcards to{" "}
            <code>stability = 21d</code>, and award upward FIRe credit across
            prerequisites.
          </div>
        </div>

        {loading && (
          <div className="py-10 flex items-center justify-center gap-2 text-sm text-on-surface-variant">
            <Loader2 size={18} className="animate-spin" />
            Preparing diagnostic challenge…
          </div>
        )}

        {loadError && (
          <div
            role="alert"
            className="rounded-xl border border-error/40 bg-error/10 p-3 text-xs text-error"
          >
            {loadError}
          </div>
        )}

        {payload && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Part 1: Hard Drill (0 Hints) */}
            <div className="rounded-xl border border-outline-variant bg-surface-container p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-on-primary-wash">
                  Part 1 · Hard Scenario Drill (Difficulty 3 · 0 Hints)
                </span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-container-high border border-outline-variant text-on-surface-variant">
                  Unassisted Only
                </span>
              </div>
              <div className="text-sm text-on-surface">
                <MarkdownRenderer content={payload.drill.prompt} />
              </div>
              <div>
                <label
                  htmlFor="challenge-drill-input"
                  className="block text-xs font-semibold text-on-surface mb-1.5"
                >
                  Your Drill Solution
                </label>
                <textarea
                  id="challenge-drill-input"
                  data-testid="challenge-drill-input"
                  className="input w-full min-h-[110px] text-sm"
                  placeholder="State mechanisms, invariants, failure modes, and trade-offs…"
                  value={drillSubmission}
                  onChange={(e) => setDrillSubmission(e.target.value)}
                  disabled={submitting || challengePassed}
                />
              </div>
            </div>

            {/* Part 2: Concise Feynman Synthesis */}
            <div className="rounded-xl border border-outline-variant bg-surface-container p-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wide text-on-primary-wash">
                Part 2 · First-Principles Feynman Synthesis
              </div>
              <p className="text-xs text-on-surface-variant">
                {payload.feynmanPrompt}
              </p>
              <div>
                <label
                  htmlFor="challenge-feynman-input"
                  className="block text-xs font-semibold text-on-surface mb-1.5"
                >
                  Your Plain-Language Synthesis
                </label>
                <textarea
                  id="challenge-feynman-input"
                  data-testid="challenge-feynman-input"
                  className="input w-full min-h-[96px] text-sm"
                  placeholder="Explain the core mechanism clearly without circular jargon…"
                  value={feynmanExplanation}
                  onChange={(e) => setFeynmanExplanation(e.target.value)}
                  disabled={submitting || challengePassed}
                />
              </div>
            </div>

            {!challengePassed && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-challenge-btn"
                  className="btn btn-primary btn-sm"
                  disabled={
                    submitting ||
                    !drillSubmission.trim() ||
                    !feynmanExplanation.trim()
                  }
                >
                  {submitting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Zap size={14} />
                  )}
                  {submitting
                    ? "Grading Challenge…"
                    : result
                      ? "Re-Submit Challenge"
                      : "Submit Fast-Track Challenge"}
                </button>
              </div>
            )}
          </form>
        )}

        {/* Celebration Card on Fast-Track Pass */}
        {challengePassed && result && (
          <div
            data-testid="challenge-pass-celebration"
            className="rounded-2xl border border-success/40 bg-success/10 p-4 space-y-3"
          >
            <div className="flex items-center gap-2.5 text-success font-bold text-sm">
              <Award size={20} />
              Fast-Track Mastery Unlocked! ({Math.round(result.score * 100)}%)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-xl bg-surface-container-low border border-outline-variant p-2.5">
                <div className="text-on-surface-variant flex items-center gap-1">
                  <Sparkles size={13} className="text-success" />
                  Cards Graduated
                </div>
                <div
                  data-testid="challenge-graduated-cards"
                  className="font-bold text-on-surface mt-0.5"
                >
                  {result.graduatedCardIds.length}{" "}
                  {result.graduatedCardIds.length === 1 ? "card" : "cards"} →
                  stability = 21d
                </div>
              </div>
              <div className="rounded-xl bg-surface-container-low border border-outline-variant p-2.5">
                <div className="text-on-surface-variant flex items-center gap-1">
                  <Flame size={13} className="text-success" />
                  FIRe Prereq Credit
                </div>
                <div
                  data-testid="challenge-fire-credit"
                  className="font-bold text-on-surface mt-0.5"
                >
                  +{result.implicit_credit_count} prerequisite{" "}
                  {result.implicit_credit_count === 1 ? "card" : "cards"}{" "}
                  credited
                </div>
              </div>
              <div className="rounded-xl bg-surface-container-low border border-outline-variant p-2.5">
                <div className="text-on-surface-variant flex items-center gap-1">
                  <BookCheck size={13} className="text-success" />
                  Guide Note
                </div>
                <div
                  data-testid="challenge-committed-section"
                  className="font-bold text-on-surface mt-0.5"
                >
                  {result.committedSectionId
                    ? `Committed → ${result.committedSectionId}`
                    : "All sections already filled"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Full Falsification-First Rubric Breakdown */}
        {result && (
          <RubricFeedbackCard
            result={result}
            title="Diagnostic Challenge Rubric Verdict"
          />
        )}

        {challengePassed && (
          <div className="flex justify-end pt-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onClose}
            >
              Return to Mastery Path
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
