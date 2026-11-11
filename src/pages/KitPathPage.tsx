import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Compass,
  Flame,
  GraduationCap,
  Layers,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Target,
  Unlock,
  Waypoints,
  Zap,
} from "lucide-react";
import {
  expandTrack,
  nodeMap,
  prerequisitesOf,
  topologicalSort,
} from "../../shared/kits/kitSkeleton.ts";
import FlashcardView, { type FlashcardItem } from "../components/study/FlashcardView";
import ChallengeNodeModal from "../components/drills/ChallengeNodeModal.tsx";
import {
  DomainGlyph,
  HelpHint,
  RetrievabilityRing,
  SegmentedControl,
  resolveKitGlyph,
} from "../components/ui";
import useAppStore from "../stores/appStore";
import useKitStore, {
  useActiveKit,
  useKitRoutePrefix,
} from "../stores/useKitStore.ts";
import { graphApi } from "../utils/api";
import { drillsApi, type DrillItem } from "../utils/pedagogyApi.ts";

interface GraphNodeEntry {
  id: string;
  name: string;
  pillarId: string;
  pillarName: string;
  pillarColor: string;
  topicId: string | null;
  summary: string;
  health: "mastered" | "due" | "decayed" | "unseen";
  strength: number;
  counts: {
    total: number;
    learning: number;
    lapsed: number;
    due: number;
    mastered: number;
  };
  locked: boolean;
}

interface GraphPayload {
  nodes: GraphNodeEntry[];
  edges: Array<{ from: string; to: string }>;
  remediationCount: number;
}

type NodeDisplayStatus =
  | "Mastered"
  | "Needs Remediation"
  | "In Progress"
  | "Ready / Unlocked"
  | "Locked";

function resolveNodeStatus(
  node: GraphNodeEntry,
  nodeDrills: readonly DrillItem[],
): NodeDisplayStatus {
  const drillMastered = nodeDrills.some((d) => d.mastered);
  if (node.health === "mastered" || (drillMastered && node.counts.total === 0)) {
    return "Mastered";
  }
  if (node.health === "decayed") return "Needs Remediation";
  if (node.locked) return "Locked";
  if (
    node.health === "due" ||
    nodeDrills.some((d) => d.attemptCount > 0) ||
    node.strength > 0
  ) {
    return "In Progress";
  }
  return "Ready / Unlocked";
}

function statusPillClasses(status: NodeDisplayStatus): string {
  switch (status) {
    case "Mastered":
      return "bg-success/10 text-success border-success/30";
    case "Needs Remediation":
      return "bg-error/10 text-error border-error/35";
    case "In Progress":
      return "bg-primary/15 text-on-primary-wash border-primary/30";
    case "Ready / Unlocked":
      return "bg-surface-container-high text-on-surface border-outline-variant";
    case "Locked":
      return "bg-surface-container-high text-on-surface-variant border-outline-variant";
  }
}

export default function KitPathPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const prefix = useKitRoutePrefix();
  const srsVersion = useAppStore((s) => s.srsVersion);
  const addToast = useAppStore((s) => s.addToast);
  const selectKitBySlug = useKitStore((s) => s.selectKitBySlug);
  const { kit, skeleton, pillars } = useActiveKit();

  const [graphData, setGraphData] = useState<GraphPayload | null>(null);
  const [drills, setDrills] = useState<DrillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTrackId, setActiveTrackId] = useState<string>("");
  const [groupMode, setGroupMode] = useState<"topological" | "pillar">(
    "topological",
  );
  const [challengeNode, setChallengeNode] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [studySession, setStudySession] = useState<{
    cards: FlashcardItem[];
    title: string;
  } | null>(null);
  const [startingSessionId, setStartingSessionId] = useState<string | null>(
    null,
  );

  const loadPathData = useCallback(async () => {
    try {
      const [gRes, dRes] = await Promise.all([
        graphApi.get() as Promise<GraphPayload>,
        drillsApi.list().catch(() => [] as DrillItem[]),
      ]);
      if (gRes && Array.isArray(gRes.nodes)) {
        setGraphData(gRes);
      }
      if (Array.isArray(dRes)) {
        setDrills(dRes);
      }
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to load Mastery Path",
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    setLoading(true);
    void loadPathData();
  }, [loadPathData, slug, srsVersion]);

  // Poll gently while background seeding is active
  useEffect(() => {
    if (kit?.status !== "seeding" || !slug) return;
    const timer = setInterval(() => {
      void selectKitBySlug(slug);
      void loadPathData();
    }, 4000);
    return () => clearInterval(timer);
  }, [kit?.status, slug, selectKitBySlug, loadPathData]);

  const effectiveNodes: GraphNodeEntry[] = useMemo(() => {
    if (graphData?.nodes?.length) return graphData.nodes;
    const pillarNames = new Map(pillars.map((p) => [p.id, p.name]));
    const pillarColors = new Map(pillars.map((p) => [p.id, p.color]));
    return skeleton.graph.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      pillarId: n.pillarId,
      pillarName: pillarNames.get(n.pillarId) ?? n.pillarId,
      pillarColor: pillarColors.get(n.pillarId) ?? "var(--color-outline)",
      topicId: n.topicId,
      summary: n.summary,
      health: "unseen" as const,
      strength: 0,
      counts: {
        total: 0,
        learning: 0,
        lapsed: 0,
        due: 0,
        mastered: 0,
      },
      locked: false,
    }));
  }, [graphData, pillars, skeleton.graph.nodes]);

  const effectiveEdges = graphData?.edges ?? skeleton.graph.edges;

  const drillsByNode = useMemo(() => {
    const map = new Map<string, DrillItem[]>();
    for (const d of drills) {
      let arr = map.get(d.nodeId);
      if (!arr) {
        arr = [];
        map.set(d.nodeId, arr);
      }
      arr.push(d);
    }
    return map;
  }, [drills]);

  const prereqMap = useMemo(
    () => prerequisitesOf(effectiveEdges),
    [effectiveEdges],
  );

  const nodesById = useMemo(() => nodeMap(effectiveNodes), [effectiveNodes]);

  const activeTrackNodeSet = useMemo(() => {
    if (!activeTrackId) return null;
    const trackDef = skeleton.graph.tracks.find((t) => t.id === activeTrackId);
    if (!trackDef) return null;
    const expanded = expandTrack(
      trackDef,
      skeleton.graph.nodes,
      skeleton.graph.edges,
    );
    return new Set(expanded);
  }, [activeTrackId, skeleton.graph]);

  const orderedNodes = useMemo(() => {
    const topoIds = topologicalSort(effectiveNodes, effectiveEdges);
    const list = topoIds
      .map((id) => nodesById.get(id))
      .filter((n): n is GraphNodeEntry => Boolean(n));
    return activeTrackNodeSet
      ? list.filter((n) => activeTrackNodeSet.has(n.id))
      : list;
  }, [effectiveNodes, effectiveEdges, nodesById, activeTrackNodeSet]);

  const overallRetrievabilityPct = useMemo(() => {
    if (effectiveNodes.length === 0) return kit?.masteryPercent ?? 0;
    const touched = effectiveNodes.filter(
      (n) =>
        n.counts.total > 0 || (drillsByNode.get(n.id)?.length ?? 0) > 0,
    );
    if (touched.length === 0) return kit?.masteryPercent ?? 0;
    const sum = effectiveNodes.reduce((acc, n) => acc + n.strength, 0);
    return Math.max(
      kit?.masteryPercent ?? 0,
      Math.round((sum / effectiveNodes.length) * 100),
    );
  }, [effectiveNodes, drillsByNode, kit?.masteryPercent]);

  const masteredNodeCount = useMemo(
    () =>
      effectiveNodes.filter(
        (n) => resolveNodeStatus(n, drillsByNode.get(n.id) ?? []) === "Mastered",
      ).length,
    [effectiveNodes, drillsByNode],
  );

  const dueCardsTotal = useMemo(() => {
    if (kit?.dueCount !== undefined) return kit.dueCount;
    return effectiveNodes.reduce(
      (sum, n) => sum + n.counts.due + n.counts.lapsed + n.counts.learning,
      0,
    );
  }, [kit?.dueCount, effectiveNodes]);

  const handleStartNodeFlashcards = async (node: GraphNodeEntry) => {
    setStartingSessionId(node.id);
    try {
      const res = (await graphApi.nodeSession(node.id)) as {
        cards?: FlashcardItem[];
        nodeName?: string;
      };
      if (res?.cards && res.cards.length > 0) {
        setStudySession({
          cards: res.cards,
          title: `${res.nodeName || node.name} · Flashcards`,
        });
      } else {
        navigate(`${prefix}/study`);
      }
    } catch {
      navigate(`${prefix}/study`);
    } finally {
      setStartingSessionId(null);
    }
  };

  const handleStartTrackSession = async (trackId: string) => {
    setStartingSessionId(`track:${trackId}`);
    try {
      const res = (await graphApi.trackSession(trackId)) as {
        cards?: FlashcardItem[];
        trackName?: string;
      };
      if (res?.cards && res.cards.length > 0) {
        setStudySession({
          cards: res.cards,
          title: `${res.trackName || "Track"} · Ordered Review`,
        });
      } else {
        addToast({
          type: "info",
          message: "No due or unlocked cards in this track yet.",
        });
      }
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Could not start track session",
      });
    } finally {
      setStartingSessionId(null);
    }
  };

  const handleLearnClick = (node: GraphNodeEntry) => {
    if (node.topicId) {
      navigate(
        `${prefix}/guide/${encodeURIComponent(node.pillarId)}/${encodeURIComponent(node.topicId)}`,
      );
      return;
    }
    try {
      sessionStorage.setItem(
        "toolbox_chat_draft",
        `Teach me "${node.name}" from first principles (${node.summary}). Start with the core intuition and check my understanding Socratically.`,
      );
      window.dispatchEvent(new CustomEvent("toolbox-chat-draft"));
    } catch {
      // ignore storage errors
    }
    navigate(`${prefix}/chat`);
  };

  const renderNodeCard = (node: GraphNodeEntry, orderIdx: number) => {
    const nodeDrills = drillsByNode.get(node.id) ?? [];
    const masteredDrills = nodeDrills.filter((d) => d.mastered).length;
    const status = resolveNodeStatus(node, nodeDrills);
    const strengthPct = Math.round(node.strength * 100);
    const prereqIds = prereqMap.get(node.id) ?? [];

    return (
      <article
        key={node.id}
        data-testid={`path-node-${node.id}`}
        className="rounded-2xl border border-outline-variant bg-surface-container-low hover:bg-surface-container transition p-4 sm:p-5 space-y-3.5"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <RetrievabilityRing
              size={34}
              strokeWidth={2.5}
              retrievability={
                status === "Mastered" ? Math.max(strengthPct, 100) : strengthPct
              }
              strokeColorOverride={
                status === "Mastered" ? "var(--color-ok)" : undefined
              }
              centerLabel={orderIdx}
            />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-serif text-lg font-medium text-on-surface">
                  {node.name}
                </h3>
                <span
                  data-testid={`path-node-status-${node.id}`}
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border inline-flex items-center gap-1 ${statusPillClasses(status)}`}
                >
                  {status === "Mastered" && <CheckCircle2 size={12} />}
                  {status === "Needs Remediation" && (
                    <AlertTriangle size={12} />
                  )}
                  {status === "Locked" && <Lock size={11} />}
                  {status === "Ready / Unlocked" && <Unlock size={11} />}
                  {status}
                </span>
                <span className="text-[11px] text-on-surface-variant font-medium">
                  {node.pillarName}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {node.summary}
              </p>
            </div>
          </div>

          {/* Fast-Track Challenge Node Button — available on EVERY node including Locked */}
          <button
            type="button"
            data-testid={`challenge-node-btn-${node.id}`}
            className="btn btn-secondary btn-sm shrink-0 self-start"
            onClick={() => setChallengeNode({ id: node.id, name: node.name })}
            title="Skip ahead with 1 Hard Drill (0 hints) + Feynman Synthesis"
          >
            <Zap size={14} className="text-on-primary-wash" />
            Challenge Node
          </button>
        </div>

        {/* Prerequisite Badges when node has prerequisites */}
        {prereqIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-on-surface-variant font-medium">
              Prerequisites:
            </span>
            {prereqIds.map((pid) => {
              const pNode = nodesById.get(pid);
              const pSatisfied =
                pNode &&
                (pNode.health === "mastered" ||
                  pNode.strength >= 0.6 ||
                  !node.locked);
              return (
                <span
                  key={pid}
                  className={`px-2 py-0.5 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 ${
                    pSatisfied
                      ? "bg-success/10 border-success/30 text-success"
                      : "bg-surface-container-high border-outline-variant text-on-surface-variant"
                  }`}
                >
                  {pSatisfied ? <CheckCircle2 size={11} /> : <Lock size={10} />}
                  {pNode?.name ?? pid}
                </span>
              );
            })}
          </div>
        )}

        {/* Continuous FSRS-6 Retrievability Strength Bar */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant tabular-nums">
            <span>
              FSRS-6 Retrievability Strength:{" "}
              <strong className="font-mono text-on-surface">{strengthPct}%</strong>
            </span>
            <span>
              {node.counts.mastered}/{node.counts.total} cards mastered ·{" "}
              {masteredDrills}/{nodeDrills.length} drills passed
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
            <div
              className={`h-full transition-all ${status === "Mastered" ? "bg-success" : "bg-on-surface"}`}
              style={{
                width: `${Math.min(100, status === "Mastered" ? Math.max(strengthPct, 100) : strengthPct)}%`,
              }}
            />
          </div>
        </div>

        {/* 4-Step Mastery Loop Actions */}
        <div className="pt-2 border-t border-outline-variant flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant mr-1">
            Mastery Loop:
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => handleLearnClick(node)}
          >
            <BookOpen size={14} />
            1. Learn
          </button>
          <Link
            to={`${prefix}/drills?node=${encodeURIComponent(node.id)}`}
            className="btn btn-ghost btn-sm"
          >
            <Target size={14} />
            2. Drill
          </Link>
          <Link
            to={`${prefix}/feynman?node=${encodeURIComponent(node.id)}`}
            className="btn btn-ghost btn-sm"
          >
            <BrainCircuit size={14} />
            3. Feynman
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm tabular-nums"
            disabled={startingSessionId === node.id}
            onClick={() => void handleStartNodeFlashcards(node)}
          >
            {startingSessionId === node.id ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <GraduationCap size={14} />
            )}
            4. Flashcards
            {node.counts.due > 0 ? ` (${node.counts.due})` : ""}
          </button>
        </div>
      </article>
    );
  };

  return (
    <div
      id="kit-path-page"
      data-testid="kit-path-page"
      className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6"
    >
      {/* Live Background Seeding Progress Banner */}
      {kit?.status === "seeding" && (
        <div
          data-testid="kit-seeding-banner"
          role="status"
          className="rounded-2xl border border-primary/40 bg-primary/12 p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <RefreshCw
              size={18}
              className="animate-spin text-on-primary-wash shrink-0"
            />
            <div className="text-xs sm:text-sm text-on-surface">
              <strong className="text-on-primary-wash">
                Curriculum Seeding in Progress:
              </strong>{" "}
              {kit.statusDetail ||
                "Generating starter flashcards and grounded scenario drills…"}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (slug) void selectKitBySlug(slug);
              void loadPathData();
            }}
          >
            Refresh
          </button>
        </div>
      )}

      {/* Kit Hero Header */}
      <header className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 sm:p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border border-outline-variant bg-surface-container-high text-on-surface"
              aria-hidden="true"
            >
              <DomainGlyph
                kind={resolveKitGlyph(
                  `${skeleton.identity.slug} ${skeleton.identity.name} ${skeleton.identity.icon ?? ""}`,
                )}
                size={22}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-serif text-2xl sm:text-3xl font-normal text-on-surface tracking-tight">
                  {skeleton.identity.name}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-container-high border border-outline-variant text-on-surface-variant inline-flex items-center gap-1">
                  <Compass size={12} />
                  Ordered Mastery Path
                </span>
                <HelpHint
                  align="left"
                  text="Master foundations to unlock downstream concepts, or Challenge any node to skip ahead."
                />
              </div>
              {skeleton.identity.description && (
                <p className="text-sm text-on-surface-variant max-w-2xl">
                  {skeleton.identity.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link
              to={dueCardsTotal > 0 ? "/review" : `${prefix}/study`}
              data-testid="kit-due-cards-btn"
              className="btn btn-primary btn-sm tabular-nums"
            >
              <Flame size={15} />
              {dueCardsTotal > 0
                ? `Review ${dueCardsTotal} Due Cards`
                : "Open Flashcards"}
            </Link>
            <Link to={`${prefix}/graph`} className="btn btn-ghost btn-sm">
              <Waypoints size={15} />
              Visual DAG
            </Link>
          </div>
        </div>

        {/* Overall FSRS-6 Mastery & Node Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-outline-variant">
          <div className="rounded-xl bg-surface-container p-3 border border-outline-variant">
            <div className="text-xs text-on-surface-variant">
              FSRS-6 Retrievability / Mastery
            </div>
            <div
              data-testid="kit-overall-mastery"
              className="font-mono text-lg font-bold text-on-surface tabular-nums mt-0.5"
            >
              {overallRetrievabilityPct}%
            </div>
            <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden mt-2">
              <div
                className="h-full bg-on-surface transition-all"
                style={{ width: `${Math.min(100, overallRetrievabilityPct)}%` }}
              />
            </div>
          </div>

          <div className="rounded-xl bg-surface-container p-3 border border-outline-variant">
            <div className="text-xs text-on-surface-variant">
              Concept Nodes Mastered
            </div>
            <div className="font-mono text-lg font-bold text-on-surface tabular-nums mt-0.5">
              {masteredNodeCount} / {effectiveNodes.length}
            </div>
            <div className="text-[11px] text-on-surface-variant tabular-nums mt-1">
              {graphData?.remediationCount
                ? `${graphData.remediationCount} remediation checkup card(s) queued`
                : "Prerequisite credit (FIRe) active"}
            </div>
          </div>

          <div className="rounded-xl bg-surface-container p-3 border border-outline-variant">
            <div className="text-xs text-on-surface-variant">
              Scenario Drills
            </div>
            <div className="font-mono text-lg font-bold text-on-surface tabular-nums mt-0.5">
              {drills.filter((d) => d.mastered).length} / {drills.length}
            </div>
            <Link
              to={`${prefix}/drills`}
              className="text-[11px] text-on-primary-wash font-semibold hover:underline inline-block mt-1"
            >
              Open Guided Drills Workspace →
            </Link>
          </div>
        </div>

        {/* Learning Track Filter Chips */}
        {skeleton.graph.tracks.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Learning Tracks
              </span>
              {activeTrackId && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={startingSessionId === `track:${activeTrackId}`}
                  onClick={() => void handleStartTrackSession(activeTrackId)}
                >
                  <Play size={13} />
                  Practice Track Cards
                </button>
              )}
            </div>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Learning tracks"
            >
              <button
                type="button"
                onClick={() => setActiveTrackId("")}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer tabular-nums ${
                  activeTrackId === ""
                    ? "bg-surface-container-high text-on-surface border-outline"
                    : "bg-surface-container text-on-surface-variant border-outline-variant hover:text-on-surface"
                }`}
              >
                All Concepts ({effectiveNodes.length})
              </button>
              {skeleton.graph.tracks.map((track) => {
                const count = expandTrack(
                  track,
                  skeleton.graph.nodes,
                  skeleton.graph.edges,
                ).length;
                const isSelected = activeTrackId === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    data-testid={`track-chip-${track.id}`}
                    onClick={() =>
                      setActiveTrackId(isSelected ? "" : track.id)
                    }
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer inline-flex items-center gap-1.5 tabular-nums ${
                      isSelected
                        ? "bg-surface-container-high text-on-surface border-outline"
                        : "bg-surface-container text-on-surface-variant border-outline-variant hover:text-on-surface"
                    }`}
                    title={track.description}
                  >
                    <Compass size={12} className="shrink-0" />
                    <span>
                      {track.name} ({count})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Ordering Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-on-surface-variant flex items-center gap-2 tabular-nums">
          <Layers size={15} />
          {activeTrackId
            ? `Track Path (${orderedNodes.length} concepts in prerequisite order)`
            : `Curriculum Concepts (${orderedNodes.length})`}
        </h2>

        <SegmentedControl
          roleType="group"
          ariaLabel="Grouping mode"
          size="xs"
          value={groupMode}
          onChange={setGroupMode}
          items={[
            { value: "topological", label: "Topological Order" },
            { value: "pillar", label: "By Pillar" },
          ]}
        />
      </div>

      {/* Concept Nodes List */}
      {loading ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-10 flex items-center justify-center gap-2 text-sm text-on-surface-variant">
          <Loader2 size={18} className="animate-spin" />
          Computing FSRS-6 prerequisite path…
        </div>
      ) : groupMode === "topological" ? (
        <div className="space-y-3">
          {orderedNodes.map((node, idx) => renderNodeCard(node, idx + 1))}
        </div>
      ) : (
        <div className="space-y-6">
          {pillars.map((pillar) => {
            const pNodes = orderedNodes.filter((n) => n.pillarId === pillar.id);
            if (pNodes.length === 0) return null;
            return (
              <section key={pillar.id} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full bg-on-surface-variant shrink-0"
                    aria-hidden="true"
                  />
                  <h3 className="font-serif text-lg font-medium text-on-surface">
                    Pillar {pillar.number}: {pillar.name}
                  </h3>
                  <span className="text-xs text-on-surface-variant tabular-nums">
                    ({pNodes.length} concepts)
                  </span>
                </div>
                <div className="space-y-3">
                  {pNodes.map((node, idx) => renderNodeCard(node, idx + 1))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Diagnostic Fast-Track Challenge Modal */}
      <ChallengeNodeModal
        nodeId={challengeNode?.id ?? null}
        nodeName={challengeNode?.name}
        open={Boolean(challengeNode)}
        onClose={() => setChallengeNode(null)}
        onCompleted={() => {
          if (slug) void selectKitBySlug(slug);
          void loadPathData();
        }}
      />

      {/* In-Path Node / Track Flashcard Session Overlay */}
      {studySession && (
        <div className="graph-session-overlay" id="path-session-overlay">
          <FlashcardView
            cards={studySession.cards}
            deckName={studySession.title}
            reviewMode
            onBack={() => {
              setStudySession(null);
              void loadPathData();
            }}
          />
        </div>
      )}
    </div>
  );
}
