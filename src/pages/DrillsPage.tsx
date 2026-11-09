import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";
import GuidedDrillWorkspace from "../components/drills/GuidedDrillWorkspace.tsx";
import useAppStore from "../stores/appStore";
import { useActiveKit, useKitRoutePrefix } from "../stores/useKitStore.ts";
import { drillsApi, type DrillItem } from "../utils/pedagogyApi.ts";

export default function DrillsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const nodeParam = searchParams.get("node") || "";
  const prefix = useKitRoutePrefix();
  const model = useAppStore((s) => s.model);
  const addToast = useAppStore((s) => s.addToast);
  const { skeleton } = useActiveKit();

  const [drills, setDrills] = useState<DrillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDrillId, setSelectedDrillId] = useState<string | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<0 | 1 | 2 | 3>(0);

  // Generator controls
  const [genNodeId, setGenNodeId] = useState<string>(
    nodeParam || skeleton.graph.nodes[0]?.id || "",
  );
  const [genDifficulty, setGenDifficulty] = useState<1 | 2 | 3>(2);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (nodeParam) {
      setGenNodeId(nodeParam);
    } else if (!genNodeId && skeleton.graph.nodes.length > 0) {
      setGenNodeId(skeleton.graph.nodes[0].id);
    }
  }, [nodeParam, skeleton.graph.nodes, genNodeId]);

  const loadDrills = useCallback(async () => {
    setLoading(true);
    try {
      const list = await drillsApi.list(nodeParam || undefined);
      setDrills(Array.isArray(list) ? list : []);
      if (Array.isArray(list) && list.length > 0) {
        setSelectedDrillId((prev) =>
          prev && list.some((d) => d.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedDrillId(null);
      }
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not load drills",
      });
    } finally {
      setLoading(false);
    }
  }, [nodeParam, addToast]);

  useEffect(() => {
    void loadDrills();
  }, [loadDrills]);

  const filteredDrills = useMemo(() => {
    return drills.filter((d) =>
      difficultyFilter === 0 ? true : d.difficulty === difficultyFilter,
    );
  }, [drills, difficultyFilter]);

  const activeDrill = useMemo(() => {
    if (filteredDrills.length === 0) return null;
    return (
      filteredDrills.find((d) => d.id === selectedDrillId) ?? filteredDrills[0]
    );
  }, [filteredDrills, selectedDrillId]);

  const handleNodeFilterChange = (nextNodeId: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextNodeId) {
      next.set("node", nextNodeId);
      setGenNodeId(nextNodeId);
    } else {
      next.delete("node");
    }
    setSearchParams(next);
  };

  const handleGenerateDrill = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const targetNode = genNodeId || nodeParam || skeleton.graph.nodes[0]?.id;
    if (!targetNode) {
      addToast({ type: "error", message: "Select a concept node first." });
      return;
    }

    setGenerating(true);
    try {
      const created = await drillsApi.generate({
        nodeId: targetNode,
        difficulty: genDifficulty,
        model,
      });
      setDrills((prev) => [created, ...prev]);
      if (difficultyFilter !== 0 && difficultyFilter !== created.difficulty) {
        setDifficultyFilter(0);
      }
      setSelectedDrillId(created.id);
      addToast({
        type: "success",
        message: `Generated Level ${created.difficulty} drill for ${created.nodeName}`,
      });
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to generate drill",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      id="drills-page"
      data-testid="drills-page"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          {prefix && (
            <Link
              to={prefix}
              className="text-xs font-semibold text-on-primary-wash hover:underline inline-flex items-center gap-1"
            >
              <ArrowLeft size={13} />
              Back to {skeleton.identity.name} Path
            </Link>
          )}
          <h1 className="text-2xl font-bold text-on-surface tracking-tight flex items-center gap-2.5">
            <Target size={24} className="text-primary" />
            Guided Scenario Drills
          </h1>
          <p className="text-sm text-on-surface-variant">
            Attempt-gated progressive hints and falsification-first rubric
            grading with upward FIRe prerequisite credit.
          </p>
        </div>

        {/* Generate New Drill Controls */}
        <form
          onSubmit={handleGenerateDrill}
          className="rounded-2xl border border-outline-variant bg-surface-container-low p-3 flex flex-wrap items-center gap-2"
        >
          <select
            aria-label="Target concept for new drill"
            value={genNodeId}
            onChange={(e) => setGenNodeId(e.target.value)}
            className="rounded-lg border border-outline-variant bg-surface-container text-on-surface text-xs px-2.5 py-2 max-w-[210px]"
          >
            {skeleton.graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>

          <select
            aria-label="New drill difficulty"
            value={genDifficulty}
            onChange={(e) =>
              setGenDifficulty(Number(e.target.value) as 1 | 2 | 3)
            }
            className="rounded-lg border border-outline-variant bg-surface-container text-on-surface text-xs px-2.5 py-2"
          >
            <option value={1}>Difficulty 1 · Foundational</option>
            <option value={2}>Difficulty 2 · Multi-Constraint</option>
            <option value={3}>Difficulty 3 · Adversarial</option>
          </select>

          <button
            type="submit"
            data-testid="generate-new-drill-btn"
            className="btn btn-primary btn-sm"
            disabled={generating}
          >
            {generating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            {generating ? "Generating…" : "Generate New Drill"}
          </button>
        </form>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="drills-node-filter"
            className="text-xs font-semibold text-on-surface-variant"
          >
            Concept Filter:
          </label>
          <select
            id="drills-node-filter"
            value={nodeParam}
            onChange={(e) => handleNodeFilterChange(e.target.value)}
            className="rounded-lg border border-outline-variant bg-surface-container text-on-surface text-xs px-2.5 py-1.5"
          >
            <option value="">All Concepts</option>
            {skeleton.graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Difficulty filter"
        >
          {(
            [
              { val: 0, label: "All Levels" },
              { val: 1, label: "Level 1" },
              { val: 2, label: "Level 2" },
              { val: 3, label: "Level 3" },
            ] as const
          ).map((item) => (
            <button
              key={item.val}
              type="button"
              onClick={() => setDifficultyFilter(item.val)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                difficultyFilter === item.val
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Layout: Drill Selector Rail + Workspace */}
      {loading ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-12 flex items-center justify-center gap-2 text-sm text-on-surface-variant">
          <Loader2 size={18} className="animate-spin" />
          Loading scenario drills…
        </div>
      ) : filteredDrills.length === 0 ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-10 text-center space-y-4 max-w-xl mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-primary/12 text-on-primary-wash flex items-center justify-center mx-auto">
            <Sparkles size={22} />
          </div>
          <h2 className="text-lg font-semibold text-on-surface">
            No Drills Yet for This Selection
          </h2>
          <p className="text-xs text-on-surface-variant">
            Generate a grounded active-recall scenario problem tailored to your
            Study Kit and committed Guide notes.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleGenerateDrill()}
            disabled={generating}
          >
            {generating ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
            {generating ? "Generating Drill…" : "Generate First Drill"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Rail: Drill Queue */}
          <aside className="lg:col-span-4 space-y-2">
            {filteredDrills.map((d) => {
              const isSelected = activeDrill?.id === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  data-testid={`drill-item-${d.id}`}
                  onClick={() => setSelectedDrillId(d.id)}
                  className={`w-full text-left rounded-2xl border p-3.5 transition cursor-pointer space-y-1.5 ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-outline-variant bg-surface-container-low hover:bg-surface-container"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-on-surface truncate">
                      {d.nodeName}
                    </span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-container-high border border-outline-variant text-on-surface-variant shrink-0">
                      L{d.difficulty}
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant line-clamp-2">
                    {d.prompt}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-on-surface-variant pt-1">
                    <span>
                      {d.attemptCount}{" "}
                      {d.attemptCount === 1 ? "attempt" : "attempts"}
                      {d.bestScore !== null
                        ? ` · best ${Math.round(d.bestScore * 100)}%`
                        : ""}
                    </span>
                    {d.mastered && (
                      <span className="text-success font-semibold inline-flex items-center gap-1">
                        <CheckCircle2 size={11} />
                        Mastered
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Right Pane: Active GuidedDrillWorkspace */}
          <div className="lg:col-span-8">
            {activeDrill && (
              <GuidedDrillWorkspace
                drill={activeDrill}
                onAttemptRecorded={(graded) => {
                  setDrills((prev) =>
                    prev.map((d) =>
                      d.id === activeDrill.id
                        ? {
                            ...d,
                            attemptCount: d.attemptCount + 1,
                            bestScore:
                              d.bestScore === null
                                ? graded.score
                                : Math.max(d.bestScore, graded.score),
                            mastered: d.mastered || Boolean(graded.masteryEligible),
                          }
                        : d,
                    ),
                  );
                }}
                onVariantCreated={(fresh) => {
                  setDrills((prev) => [fresh, ...prev]);
                  setSelectedDrillId(fresh.id);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
