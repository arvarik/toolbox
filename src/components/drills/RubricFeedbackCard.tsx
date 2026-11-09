import { Link } from "react-router";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Flame,
  HelpCircle,
  ListChecks,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import MarkdownRenderer from "../shared/MarkdownRenderer";
import { useKitRoutePrefix } from "../../stores/useKitStore.ts";
import type {
  EvaluationFeedback,
  ImplicitCreditSummary,
  RemediationItem,
} from "../../utils/pedagogyApi.ts";

export interface RubricFeedbackCardProps {
  result: EvaluationFeedback & {
    implicitCredit?: ImplicitCreditSummary;
    implicit_credit_count?: number;
    remediation?: RemediationItem[];
  };
  title?: string;
  onGenerateUnassistedVariant?: () => void;
  isGeneratingVariant?: boolean;
}

export default function RubricFeedbackCard({
  result,
  title = "Falsification-First Rubric Evaluation",
  onGenerateUnassistedVariant,
  isGeneratingVariant = false,
}: RubricFeedbackCardProps) {
  const prefix = useKitRoutePrefix();
  const pct = Math.round((result.score ?? 0) * 100);
  const isAssisted = Boolean(
    result.assisted ||
      (result.hintsUsed ?? 0) >= 3 ||
      result.viewedWorkedSolution,
  );
  const isMasteryEligible =
    result.masteryEligible !== undefined
      ? result.masteryEligible
      : result.pass && !isAssisted;

  const creditCount =
    result.implicit_credit_count ??
    result.implicitCredit?.updatedCardIds?.length ??
    0;
  const creditedNodes = result.implicitCredit?.nodesCredited ?? [];
  const remediation = result.remediation ?? [];

  return (
    <section
      data-testid="rubric-feedback-card"
      className="rounded-2xl border border-outline-variant bg-surface-container-low p-4 sm:p-5 space-y-4"
      aria-label={title}
    >
      {/* Top Verdict & Score Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <div
            data-testid="rubric-score-pill"
            className={`px-3 py-1.5 rounded-xl text-base font-extrabold border ${
              isMasteryEligible
                ? "bg-success/15 text-success border-success/30"
                : isAssisted
                  ? "bg-warning/10 text-warning border-warning/30"
                  : "bg-error/10 text-error border-error/30"
            }`}
          >
            {pct}%
          </div>
          <div>
            <h3 className="text-sm font-bold text-on-surface">{title}</h3>
            <div className="text-xs text-on-surface-variant flex flex-wrap items-center gap-2 mt-0.5">
              {isAssisted ? (
                <span
                  data-testid="rubric-assisted-badge"
                  className="font-semibold text-warning"
                >
                  Assisted Attempt (Mastery Ineligible)
                </span>
              ) : result.pass ? (
                <span
                  data-testid="rubric-pass-badge"
                  className="font-semibold text-success"
                >
                  Passed Rubric
                </span>
              ) : (
                <span
                  data-testid="rubric-fail-badge"
                  className="font-semibold text-error"
                >
                  Needs Revision
                </span>
              )}
              {result.hintsUsed === 2 && !isAssisted && (
                <span>• Capped at 80% (Setup Hint used)</span>
              )}
            </div>
          </div>
        </div>

        {isAssisted && onGenerateUnassistedVariant && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="generate-unassisted-variant-btn"
            onClick={onGenerateUnassistedVariant}
            disabled={isGeneratingVariant}
          >
            <Sparkles size={14} />
            {isGeneratingVariant
              ? "Generating Variant…"
              : "Generate Unassisted Variant"}
          </button>
        )}
      </div>

      {/* Assisted Notice Banner */}
      {isAssisted && (
        <div
          data-testid="assisted-mastery-banner"
          className="rounded-xl border border-warning/35 bg-warning/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-on-surface"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
            <span>
              <strong>Assisted Practice:</strong> Hint 3 or the Worked Solution
              was revealed, so this attempt does not unlock unassisted Mastery.
              Solve a fresh variant without Hint 3 to complete the Mastery Loop.
            </span>
          </div>
        </div>
      )}

      {/* Upward FIRe Prerequisite Credit */}
      {creditCount > 0 && (
        <div
          data-testid="fire-credit-banner"
          className="rounded-xl border border-success/35 bg-success/10 p-3 flex items-start gap-2.5 text-xs text-on-surface"
        >
          <Flame size={16} className="text-success shrink-0 mt-0.5" />
          <div>
            <strong className="text-success">
              FIRe Prerequisite Credit (+{creditCount}{" "}
              {creditCount === 1 ? "card" : "cards"}):
            </strong>{" "}
            Demonstrating mastery here automatically extended FSRS-6 stability
            across foundational prerequisite cards
            {creditedNodes.length > 0
              ? ` (${creditedNodes.join(", ")})`
              : ""}.
          </div>
        </div>
      )}

      {/* Prominent Factual / Logical Errors Callout */}
      {result.factualOrLogicalErrors?.length > 0 && (
        <div
          data-testid="factual-errors-callout"
          role="alert"
          className="rounded-xl border border-error/40 bg-error/10 p-3.5 space-y-2"
        >
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-error">
            <AlertOctagon size={15} />
            Factual or Logical Contradictions ({result.factualOrLogicalErrors.length})
          </div>
          <ul className="list-disc pl-5 space-y-1 text-xs text-on-surface">
            {result.factualOrLogicalErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Unexplained Jargon */}
      {result.unexplainedJargon?.length > 0 && (
        <div
          data-testid="unexplained-jargon-box"
          className="rounded-xl border border-warning/35 bg-warning/10 p-3 space-y-1.5"
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
            <HelpCircle size={14} />
            Unexplained Jargon — Unpack These Terms
          </div>
          <div className="flex flex-wrap gap-1.5">
            {result.unexplainedJargon.map((term, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded-md bg-surface-container-high border border-outline-variant text-xs font-mono text-on-surface"
              >
                {term}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rubric Dimension Checks */}
      {result.rubricChecks?.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
            <ListChecks size={14} />
            Rubric Criteria ({result.rubricChecks.filter((r) => r.met).length}/
            {result.rubricChecks.length} met)
          </div>
          <div className="space-y-2">
            {result.rubricChecks.map((rc, idx) => {
              const detail = rc.evidenceOrGap || rc.quoteOrGap || "";
              return (
                <div
                  key={idx}
                  data-testid={`rubric-check-${idx}`}
                  className="rounded-xl border border-outline-variant bg-surface-container p-3 flex items-start gap-2.5"
                >
                  {rc.met ? (
                    <CheckCircle2
                      size={16}
                      className="text-success shrink-0 mt-0.5"
                    />
                  ) : (
                    <XCircle
                      size={16}
                      className="text-error shrink-0 mt-0.5"
                    />
                  )}
                  <div className="min-w-0 space-y-1 text-xs">
                    <div className="font-semibold text-on-surface">
                      {rc.point}
                    </div>
                    {detail && (
                      <div className="text-on-surface-variant">{detail}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Extracted Claims */}
      {result.extractedClaims?.length > 0 && (
        <details className="rounded-xl border border-outline-variant bg-surface-container px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold text-on-surface-variant select-none">
            Extracted Claims Verified ({result.extractedClaims.length})
          </summary>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-on-surface">
            {result.extractedClaims.map((claim, idx) => (
              <li key={idx}>{claim}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Constructive Feedback & Socratic Probe */}
      {result.constructiveFeedback && (
        <div className="text-xs text-on-surface space-y-1 pt-1">
          <div className="font-semibold text-on-surface-variant uppercase tracking-wide">
            Feedback
          </div>
          <MarkdownRenderer content={result.constructiveFeedback} />
        </div>
      )}

      {result.socraticFollowUp && (
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs text-on-surface space-y-1">
          <div className="font-semibold text-on-primary-wash">
            Socratic Follow-Up Question
          </div>
          <MarkdownRenderer content={result.socraticFollowUp} />
        </div>
      )}

      {/* Downward Remediation Queue Links when score < 0.6 */}
      {remediation.length > 0 && (
        <div
          data-testid="remediation-queue-callout"
          className="rounded-xl border border-warning/35 bg-surface-container p-3.5 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-warning">
              <Wrench size={15} />
              Prerequisite Remediation Queued ({remediation.length})
            </div>
            <Link
              to={`${prefix}/study`}
              className="btn btn-secondary btn-sm"
            >
              Review Prerequisite Cards
            </Link>
          </div>
          <ul className="space-y-1.5 text-xs">
            {remediation.map((item) => (
              <li
                key={item.cardId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-low px-2.5 py-1.5 border border-outline-variant"
              >
                <span className="text-on-surface">
                  {item.nodeName ? (
                    <strong>{item.nodeName}: </strong>
                  ) : null}
                  {item.front || item.reason}
                </span>
                {item.nodeId && (
                  <Link
                    to={`${prefix}/drills?node=${encodeURIComponent(item.nodeId)}`}
                    className="text-on-primary-wash font-semibold hover:underline shrink-0"
                  >
                    Drill {item.nodeName || item.nodeId} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
