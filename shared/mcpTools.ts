/**
 * Canonical catalog of Toolbox MCP tools: name, title, description, and effect.
 * Shared across the stateless MCP server (`server/mcp/`) and the Settings UI
 * (`src/components/settings/McpSettingsSection.tsx`) so tool names, annotations,
 * and read-only gating can never drift.
 *
 * Runtime-pure: zero `node:*`, `express`, or `react` imports.
 */

/**
 * What a tool may change:
 * - `read`: mutates nothing.
 * - `add`: creates records or records study progress without overwriting/deleting user notes.
 * - `change`: overwrites or modifies existing user content, so clients may prompt first.
 */
export type McpToolEffect = "read" | "add" | "change";

export interface McpToolDefinition {
  name: string;
  /** Short human-readable label displayed in MCP clients and Settings. */
  title: string;
  description: string;
  effect: McpToolEffect;
  /** Identical repeat calls produce the same stored state. */
  idempotent?: boolean;
  /**
   * Output may contain untrusted or imported prose (shared Kits, PDFs, web pages).
   * When true, `toolDefiner` appends the `<untrusted_data>` safety rule.
   */
  othersText?: boolean;
}

export const MCP_TOOLS = [
  {
    name: "list_kits",
    title: "List study Kits",
    description:
      "List your personal study Kits with mastery percentage, due flashcard counts, pillar/topic/node counts, and compiler status.",
    effect: "read",
    othersText: true,
  },
  {
    name: "get_kit_path",
    title: "Get Kit mastery path",
    description:
      "Retrieve a Kit's curriculum pillars/topics/sections, topological concept DAG order, live FSRS-6 node health and retrievability, and learning tracks by Kit slug or ID.",
    effect: "read",
    othersText: true,
  },
  {
    name: "search_kit",
    title: "Search Kit knowledge",
    description:
      "Hybrid BM25 + vector search (Reciprocal Rank Fusion) across a Kit's (or all Kits') study guide notes, flashcards, uploaded source chunks, and episodic memory.",
    effect: "read",
    othersText: true,
  },
  {
    name: "get_due_cards",
    title: "Get due flashcards",
    description:
      "List flashcards currently due for FSRS-6 spaced-repetition review (including prioritized prerequisite remediation cards), optionally filtered by Kit slug or ID.",
    effect: "read",
    othersText: true,
  },
  {
    name: "create_flashcards",
    title: "Create flashcards",
    description:
      "Batch-create 1 to 50 flashcards inside a Kit deck (auto-selecting or creating a deck if deckId is omitted), optionally tagged with nodeId, pillarId, topicId, sectionId, and prerequisiteCardId.",
    effect: "add",
  },
  {
    name: "review_card",
    title: "Review a flashcard",
    description:
      "Submit an FSRS-6 review rating (1 Again, 2 Hard, 3 Good, 4 Easy; or SM-2 quality 0-5) for a flashcard, updating stability/difficulty, propagating upward FIRe prerequisite credit, planning downward remediation on lapse, and ticking today's study heatmap.",
    effect: "add",
  },
  {
    name: "commit_guide_note",
    title: "Commit a study guide note",
    description:
      "Write, replace, or append a Markdown study note in a Kit's (pillarId, topicId, sectionId) Guide slot (validated against the Kit skeleton) and index it for hybrid search.",
    effect: "change",
    idempotent: true,
  },
] as const satisfies readonly McpToolDefinition[];

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];

export const MCP_TOOL_BY_NAME: Record<McpToolName, McpToolDefinition> =
  Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool])) as Record<
    McpToolName,
    McpToolDefinition
  >;

/**
 * Standard MCP `ToolAnnotations` derived from a tool's `effect` and `idempotent` flag.
 * Every Toolbox MCP tool operates strictly on the caller's scoped SQLite records (`openWorldHint: false`).
 */
export function mcpToolAnnotations(tool: McpToolDefinition) {
  if (tool.effect === "read") {
    return {
      title: tool.title,
      readOnlyHint: true,
      openWorldHint: false,
    };
  }
  return {
    title: tool.title,
    readOnlyHint: false,
    destructiveHint: tool.effect === "change",
    idempotentHint: tool.idempotent === true,
    openWorldHint: false,
  };
}
