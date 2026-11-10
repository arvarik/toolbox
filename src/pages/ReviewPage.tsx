import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowLeft,
  Flame,
  Keyboard,
  Layers,
  Loader2,
  PenLine,
  Wrench,
} from "lucide-react";
import MarkdownRenderer from "../components/shared/MarkdownRenderer";
import type { SrsPreviews } from "../components/study/FlashcardView";
import {
  DomainGlyph,
  Kbd,
  KitAvatar,
  resolveKitGlyph,
} from "../components/ui";
import useAppStore from "../stores/appStore";
import { useKitStore } from "../stores/useKitStore";
import { flashcardsApi } from "../utils/api";

const DAY_MS = 24 * 60 * 60 * 1000;
const FSRS6_DECAY = 0.1542;
const FSRS6_FACTOR = Math.pow(0.9, -1 / FSRS6_DECAY) - 1;

function computeFsrsRetrievabilityPct(card: DueReviewCard): number | null {
  const s = card.stability;
  if (typeof s !== "number" || !Number.isFinite(s) || s <= 0) return null;
  let elapsedDays = 0;
  if (card.last_reviewed) {
    const lastMs = Date.parse(card.last_reviewed);
    if (Number.isFinite(lastMs)) {
      elapsedDays = Math.max(0, (Date.now() - lastMs) / DAY_MS);
    }
  }
  const r = Math.pow(1 + (FSRS6_FACTOR * elapsedDays) / s, -FSRS6_DECAY);
  return Math.round(Math.max(0, Math.min(1, r)) * 100);
}

export interface DueReviewCard {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  state?: number;
  stability?: number | null;
  difficulty?: number | null;
  last_reviewed?: string | null;
  deckName?: string;
  is_remediation?: number;
  remediation_reason?: string;
  remediation_node?: string | null;
  kit_slug?: string;
  kit_name?: string;
  kit_icon?: string;
  kit_color?: string;
  srs_previews?: SrsPreviews;
}

interface ReviewResponse extends DueReviewCard {
  implicit_credit_count?: number;
  remediation?: Array<{
    cardId: string;
    front: string;
    nodeName: string | null;
    reason: string;
  }>;
}

export default function ReviewPage() {
  const navigate = useNavigate();
  const addToast = useAppStore((s) => s.addToast);

  const [queue, setQueue] = useState<DueReviewCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [typeAnswerOpen, setTypeAnswerOpen] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const confidence = "medium" as const;

  // Session telemetry & live FSRS/FIRe feedback
  const [reviewedCount, setReviewedCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalFireCredits, setTotalFireCredits] = useState(0);
  const [lastFeedbackBanner, setLastFeedbackBanner] = useState<{
    fireCount: number;
    stability: number | null;
    difficulty: number | null;
    remediationCount: number;
  } | null>(null);
  const [sessionDone, setSessionDone] = useState(false);
  const requeuedOnceRef = useRef<Set<string>>(new Set());
  const kitsTouchedRef = useRef<Set<string>>(new Set());

  // Runs once on mount, so the session state still holds its initial values.
  const loadDueQueue = useCallback(async () => {
    void useKitStore.getState().selectKitBySlug(null);
    try {
      const rows = (await flashcardsApi.dueAll()) as DueReviewCard[] | null;
      setQueue(Array.isArray(rows) ? rows : []);
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to load cross-Kit review queue",
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadDueQueue();
  }, [loadDueQueue]);

  const currentCard = queue[currentIndex];

  const handleGrade = useCallback(
    async (quality: 1 | 3 | 4 | 5) => {
      if (!currentCard || submitting) return;
      setSubmitting(true);
      try {
        const res = (await flashcardsApi.review(
          currentCard.deck_id,
          currentCard.id,
          quality,
          confidence,
        )) as ReviewResponse;

        useAppStore.getState().bumpSrsVersion();

        const kName = currentCard.kit_name;
        if (kName) kitsTouchedRef.current.add(kName);

        const fireCount = res?.implicit_credit_count ?? 0;
        const remCount = res?.remediation?.length ?? 0;

        if (fireCount > 0) {
          setTotalFireCredits((c) => c + fireCount);
          addToast({
            type: "success",
            message: `FIRe Credit: +${fireCount} prerequisite ${fireCount === 1 ? "card" : "cards"} gained FSRS-6 stability!`,
          });
        }
        if (remCount > 0) {
          addToast({
            type: "info",
            message: `Queued ${remCount} prerequisite remediation ${remCount === 1 ? "card" : "cards"}`,
          });
        }

        setLastFeedbackBanner({
          fireCount,
          stability: res?.stability ?? null,
          difficulty: res?.difficulty ?? null,
          remediationCount: remCount,
        });

        setReviewedCount((c) => c + 1);
        if (quality >= 3) setCorrectCount((c) => c + 1);

        const shouldRequeue =
          quality === 1 &&
          (res?.state === 1 || res?.state === 3) &&
          !requeuedOnceRef.current.has(currentCard.id);

        let nextQueueLen = queue.length;
        if (shouldRequeue) {
          requeuedOnceRef.current.add(currentCard.id);
          nextQueueLen += 1;
          setQueue((prev) => [...prev, { ...currentCard, ...res }]);
        }

        const nextIdx = currentIndex + 1;
        setRevealed(false);
        setTypedAnswer("");

        if (nextIdx >= nextQueueLen) {
          setSessionDone(true);
        } else {
          setCurrentIndex(nextIdx);
        }
      } catch (err) {
        addToast({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to save review",
        });
      } finally {
        setSubmitting(false);
      }
    },
    [currentCard, submitting, queue.length, currentIndex, addToast],
  );

  // Keyboard shortcuts: Space to reveal, 1 Again / 2 Hard / 3 Good / 4 Easy
  useEffect(() => {
    if (loading || sessionDone || !currentCard || submitting) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() || "";
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }

      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (!revealed) {
          setRevealed(true);
        }
        return;
      }

      if (revealed) {
        if (e.key === "1") {
          e.preventDefault();
          void handleGrade(1);
        } else if (e.key === "2") {
          e.preventDefault();
          void handleGrade(3);
        } else if (e.key === "3") {
          e.preventDefault();
          void handleGrade(4);
        } else if (e.key === "4") {
          e.preventDefault();
          void handleGrade(5);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, sessionDone, currentCard, submitting, revealed, handleGrade]);

  if (loading) {
    return (
      <div
        id="review-page"
        className="max-w-3xl mx-auto px-4 py-16 flex items-center justify-center gap-2 text-sm text-on-surface-variant"
      >
        <Loader2 size={18} className="animate-spin" />
        Loading daily review queue…
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div
        id="review-page"
        data-testid="review-empty-state"
        className="max-w-xl mx-auto px-4 py-16 text-center space-y-4"
      >
        <div className="flex justify-center">
          <KitAvatar size={36} state="done" />
        </div>
        <h1 className="font-serif text-2xl font-normal text-on-surface">
          All caught up across every Kit
        </h1>
        <p className="text-sm text-on-surface-variant">
          Zero due cards remain in your unified FSRS-6 review queue.
        </p>
        <div className="pt-2">
          <Link to="/" className="btn btn-primary">
            <ArrowLeft size={15} />
            Back to Library
          </Link>
        </div>
      </div>
    );
  }

  if (sessionDone) {
    const accuracy =
      reviewedCount > 0 ? Math.round((correctCount / reviewedCount) * 100) : 100;
    return (
      <div
        id="review-page"
        data-testid="review-completion-summary"
        className="max-w-xl mx-auto px-4 py-12 space-y-6"
      >
        <section className="notebook-sheet rounded-2xl p-6 sm:p-8 text-center space-y-5">
          <div className="flex justify-center">
            <KitAvatar size={36} state="done" />
          </div>
          <div className="space-y-1">
            <h1 className="font-serif text-2xl font-normal text-on-surface">
              Daily review complete
            </h1>
            <p className="text-sm text-on-surface-variant tabular-nums">
              FSRS-6 stability updated across{" "}
              {Math.max(1, kitsTouchedRef.current.size)}{" "}
              {kitsTouchedRef.current.size === 1 ? "Study Kit" : "Study Kits"}.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-left">
            <div className="rounded-xl bg-surface-container p-3 border border-outline-variant">
              <div className="text-xs text-on-surface-variant">Reviewed</div>
              <div className="text-lg font-mono font-bold text-on-surface tabular-nums">
                {reviewedCount}
              </div>
            </div>
            <div className="rounded-xl bg-surface-container p-3 border border-outline-variant">
              <div className="text-xs text-on-surface-variant">Retention</div>
              <div className="text-lg font-mono font-bold text-success tabular-nums">
                {accuracy}%
              </div>
            </div>
            <div className="rounded-xl bg-surface-container p-3 border border-outline-variant">
              <div className="text-xs text-on-surface-variant">FIRe Credits</div>
              <div
                data-testid="summary-fire-credits"
                className="text-lg font-mono font-bold text-on-primary-wash tabular-nums"
              >
                +{totalFireCredits}
              </div>
            </div>
          </div>

          {lastFeedbackBanner && lastFeedbackBanner.fireCount > 0 && (
            <div
              data-testid="review-fire-credit-pill"
              className="rounded-xl border border-success/35 bg-success/10 px-3 py-2 text-xs text-success font-semibold inline-flex items-center gap-1.5 tabular-nums"
            >
              <Flame size={14} />
              +{lastFeedbackBanner.fireCount} prerequisite{" "}
              {lastFeedbackBanner.fireCount === 1 ? "card" : "cards"} auto-credited
              via FIRe
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              data-testid="return-library-btn"
              className="btn btn-primary"
              onClick={() => navigate("/")}
            >
              <Layers size={15} />
              Return to Study Library
            </button>
          </div>
        </section>
      </div>
    );
  }

  const kitName = currentCard.kit_name ?? "Study Kit";
  const kitSlug = currentCard.kit_slug ?? "";
  const deckName = currentCard.deckName ?? "Deck";
  const retrievabilityPct = computeFsrsRetrievabilityPct(currentCard);
  const remainingCards = queue.length - currentIndex;
  const stackLayers = Math.min(2, Math.max(0, remainingCards - 1));
  const previews = currentCard.srs_previews ?? {
    again: "1m",
    hard: "5m",
    good: "10m",
    easy: "4d",
  };

  return (
    <div
      id="review-page"
      data-testid="review-page"
      className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5"
    >
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} />
          Library
        </Link>

        <div className="flex items-center gap-2 text-xs text-on-surface-variant">
          <button
            type="button"
            aria-pressed={typeAnswerOpen}
            onClick={() => setTypeAnswerOpen((v) => !v)}
            className={`btn btn-sm ${
              typeAnswerOpen
                ? "bg-primary/15 text-on-primary-wash border-primary/35"
                : "btn-ghost"
            }`}
          >
            <PenLine size={13} />
            Type answer
          </button>
          <span className="tabular-nums">
            Card <strong className="text-on-surface">{currentIndex + 1}</strong>{" "}
            of <strong className="text-on-surface">{queue.length}</strong>
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label="Toggle keyboard shortcuts"
            onClick={() => setShowShortcuts((v) => !v)}
          >
            <Keyboard size={15} />
          </button>
        </div>
      </div>

      {/* Live FIRe / FSRS-6 Feedback Pill from Previous Card */}
      {lastFeedbackBanner && (
        <div className="flex flex-wrap items-center gap-2">
          {lastFeedbackBanner.fireCount > 0 && (
            <span
              data-testid="review-fire-credit-pill"
              className="px-3 py-1 rounded-full text-xs font-semibold bg-success/10 text-success border border-success/35 inline-flex items-center gap-1.5 tabular-nums"
            >
              <Flame size={13} />
              FIRe Credit: +{lastFeedbackBanner.fireCount} prerequisite{" "}
              {lastFeedbackBanner.fireCount === 1 ? "card" : "cards"} stabilized
            </span>
          )}
          {lastFeedbackBanner.stability !== null && (
            <span className="px-2.5 py-1 rounded-full text-xs font-mono tabular-nums bg-surface-container-low border border-outline-variant text-on-surface-variant">
              Last FSRS-6: S={lastFeedbackBanner.stability.toFixed(1)}d
              {lastFeedbackBanner.difficulty !== null
                ? ` · D=${lastFeedbackBanner.difficulty.toFixed(1)}`
                : ""}
            </span>
          )}
        </div>
      )}

      {/* Remediation Banner if card was queued from a prerequisite lapse */}
      {currentCard.is_remediation === 1 && (
        <div
          data-testid="review-remediation-banner"
          className="rounded-xl border border-warning/35 bg-warning/10 p-3 text-xs text-on-surface flex items-center gap-2"
        >
          <Wrench size={14} className="text-warning shrink-0" />
          <span>
            <strong>Foundation Checkup:</strong>{" "}
            {currentCard.remediation_node
              ? `${currentCard.remediation_node} — `
              : ""}
            {currentCard.remediation_reason ||
              "Prerequisite surfaced to reinforce downstream concepts."}
          </span>
        </div>
      )}

      {/* Physical Index-Card Stack + Active Notebook Sheet */}
      <div className={stackLayers > 0 ? "relative pb-2.5" : "relative"}>
        {stackLayers >= 2 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-4 bottom-0 h-6 rounded-2xl border border-outline-variant bg-surface-container-low opacity-70"
          />
        )}
        {stackLayers >= 1 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-2 bottom-1 h-6 rounded-2xl border border-outline-variant bg-surface-container-low"
          />
        )}

        <article className="notebook-sheet relative z-10 rounded-2xl p-5 sm:p-7 space-y-5">
          {/* Kit Badge + FSRS-6 Telemetry */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-outline-variant">
            <div
              data-testid="review-kit-badge"
              className="px-3 py-1 rounded-xl bg-surface-container-high border border-outline-variant text-xs font-semibold text-on-surface inline-flex items-center gap-2"
            >
              <DomainGlyph
                kind={resolveKitGlyph(
                  `${kitSlug} ${kitName} ${currentCard.kit_icon ?? ""}`,
                )}
                size={14}
              />
              {kitSlug ? (
                <Link
                  to={`/k/${encodeURIComponent(kitSlug)}`}
                  className="hover:underline"
                >
                  {kitName}
                </Link>
              ) : (
                <span>{kitName}</span>
              )}
              <span className="text-on-surface-variant">·</span>
              <span className="text-on-surface-variant font-medium">
                {deckName}
              </span>
            </div>

            <div
              data-testid="review-fsrs-telemetry"
              className="text-xs font-mono tabular-nums text-on-surface-variant flex items-center gap-2"
            >
              {typeof currentCard.stability === "number" &&
              currentCard.stability > 0 ? (
                <>
                  <span>S={currentCard.stability.toFixed(1)}d</span>
                  {typeof currentCard.difficulty === "number" && (
                    <span>D={currentCard.difficulty.toFixed(1)}</span>
                  )}
                  {retrievabilityPct !== null && (
                    <span
                      className={
                        retrievabilityPct < 70
                          ? "text-error font-semibold"
                          : "text-on-surface font-semibold"
                      }
                    >
                      R={retrievabilityPct}%
                    </span>
                  )}
                </>
              ) : (
                <span>New Card (FSRS-6 init)</span>
              )}
            </div>
          </div>

          {/* Question */}
          <div className="space-y-2 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              Prompt
            </div>
            <div
              data-testid="review-card-front"
              className="font-serif text-lg text-on-surface leading-relaxed"
            >
              <MarkdownRenderer content={currentCard.front} />
            </div>
          </div>

          {/* Optional Scratchpad + Pure Anki Reveal or Answer + Rating Buttons */}
          {!revealed ? (
            <div className="pt-4 border-t border-outline-variant space-y-3">
              {typeAnswerOpen && (
                <textarea
                  aria-label="Jot your recall before flipping"
                  placeholder="Jot your recall before flipping…"
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      setRevealed(true);
                    }
                  }}
                  rows={2}
                  className="input w-full text-sm"
                />
              )}

              <button
                type="button"
                data-testid="reveal-answer-btn"
                className="btn btn-primary w-full justify-center py-3"
                onClick={() => setRevealed(true)}
              >
                <span>Reveal Answer</span>
                <Kbd>Space</Kbd>
              </button>
            </div>
          ) : (
            <div className="pt-4 border-t border-outline-variant space-y-5">
              {typedAnswer.trim() && (
                <div className="rounded-xl border border-outline-variant bg-surface-container p-3 text-xs text-on-surface-variant">
                  <span className="font-semibold text-on-surface">
                    Your recall:
                  </span>{" "}
                  {typedAnswer.trim()}
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  Answer
                </div>
                <div
                  data-testid="review-card-back"
                  className="text-sm sm:text-base text-on-surface leading-relaxed"
                >
                  <MarkdownRenderer content={currentCard.back} />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {(
                  [
                    {
                      keyHint: "1",
                      quality: 1 as const,
                      label: "Again",
                      interval: previews.again,
                      cls: "border-error/40 bg-error/8 text-error hover:bg-error/10",
                    },
                    {
                      keyHint: "2",
                      quality: 3 as const,
                      label: "Hard",
                      interval: previews.hard,
                      cls: "border-warning/40 bg-warning/10 text-warning hover:bg-warning/14",
                    },
                    {
                      keyHint: "3",
                      quality: 4 as const,
                      label: "Good",
                      interval: previews.good,
                      cls: "border-success/40 bg-success/10 text-success hover:bg-success/14",
                    },
                    {
                      keyHint: "4",
                      quality: 5 as const,
                      label: "Easy",
                      interval: previews.easy,
                      cls: "border-primary/40 bg-primary/12 text-on-primary-wash hover:bg-primary/20",
                    },
                  ] as const
                ).map((btn) => (
                  <button
                    key={btn.quality}
                    type="button"
                    data-testid={`grade-btn-${btn.label.toLowerCase()}`}
                    disabled={submitting}
                    onClick={() => void handleGrade(btn.quality)}
                    className={`rounded-xl border px-3 py-2.5 flex flex-col items-center gap-1 transition cursor-pointer active:scale-95 ${btn.cls}`}
                  >
                    <span className="text-sm font-semibold inline-flex items-center gap-1.5">
                      {btn.label}
                      <Kbd>{btn.keyHint}</Kbd>
                    </span>
                    <span className="text-xs font-mono tabular-nums opacity-85">
                      {btn.interval}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </article>
      </div>

      {showShortcuts && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-3 text-xs text-on-surface-variant flex flex-wrap gap-x-5 gap-y-1.5 items-center">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Space</Kbd> Reveal answer
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>1</Kbd> Again
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>2</Kbd> Hard
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>3</Kbd> Good
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>4</Kbd> Easy
          </span>
        </div>
      )}
    </div>
  );
}
