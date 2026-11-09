/**
 * Zero-dependency OpenAI-compatible mock upstream (`node:http`) for deterministic
 * production E2E coverage of Toolbox v2 AI workflows:
 *   - `GET /v1/models`
 *   - `POST /v1/chat/completions` (both structured `json_schema` and SSE `stream: true`)
 */
import http from "node:http";
import type { ToolboxInstance } from "./instance.ts";

export interface RecordedAiRequest {
  stream: boolean;
  systemPrompt: string;
  userPrompt: string;
}

export interface MockAiServer {
  readonly v1URL: string;
  readonly modelId: string;
  readonly requests: RecordedAiRequest[];
  reset(): void;
  stop(): Promise<void>;
}

const MOCK_MODEL_ID = "mock-v2-chat";

interface ChatMessagePayload {
  role?: string;
  content?: unknown;
}

interface ChatCompletionRequestBody {
  model?: string;
  stream?: boolean;
  messages?: ChatMessagePayload[];
  response_format?: {
    type?: string;
    json_schema?: {
      name?: string;
      schema?: {
        properties?: Record<string, unknown>;
      };
    };
  };
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

function extractMatches(text: string, regex: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(regex)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function buildBasePillars() {
  return [
    {
      id: "quorum-foundations",
      name: "Quorum & Logical Time",
      shortName: "Quorums",
      color: "#006a91",
      sections: [
        {
          id: "mental-model",
          name: "Core Mental Model",
          icon: "compass",
          promptHint: "Explain causal ordering and quorum overlap invariants.",
          ownershipRule: "Core definitions, safety invariants, and intuition.",
        },
        {
          id: "mechanics-tradeoffs",
          name: "Mechanics & Tradeoffs",
          icon: "sliders",
          promptHint: "Analyze read/write quorum sizing and latency tradeoffs.",
          ownershipRule: "Protocol mechanics, complexity, and failure modes.",
        },
      ],
      topics: [
        {
          id: "logical-clocks",
          name: "Logical & Lamport Clocks",
          summary: "Happens-before partial ordering without synchronized physical clocks.",
        },
        {
          id: "majority-quorums",
          name: "Majority Quorum Intersection",
          summary: "Guaranteeing state overlap across concurrent read/write epochs.",
        },
      ],
    },
    {
      id: "raft-replication",
      name: "Raft Consensus & Replication",
      shortName: "Raft",
      color: "#2563eb",
      sections: [
        {
          id: "mental-model",
          name: "Core Mental Model",
          icon: "compass",
          promptHint: "State the Election Safety and Log Matching invariants.",
          ownershipRule: "Term rules, leader authority, and commit conditions.",
        },
        {
          id: "applied-practice",
          name: "Applied Patterns",
          icon: "layers",
          promptHint: "Trace split-brain recovery and linearizable client reads.",
          ownershipRule: "Production failure scenarios and operational diagnostics.",
        },
      ],
      topics: [
        {
          id: "leader-election",
          name: "TermFenced Leader Election",
          summary: "Randomized election timeouts and up-to-date log voting rules.",
        },
        {
          id: "log-replication",
          name: "Replicated Log Commitment",
          summary: "AppendEntries consistency checks and current-term commit rules.",
        },
      ],
    },
  ];
}

function buildBaseNodes() {
  return [
    {
      id: "lamport-clocks",
      name: "Lamport Timestamps",
      pillarId: "quorum-foundations",
      topicId: "logical-clocks",
      summary: "Monotonic logical counters capturing causal happens-before edges.",
      keywords: ["lamport", "causality", "logical-clock"],
      components: [],
      prereqIds: [],
    },
    {
      id: "quorum-intersection",
      name: "Majority Quorum Overlap",
      pillarId: "quorum-foundations",
      topicId: "majority-quorums",
      summary: "Any two majorities of N replicas share at least one witness replica.",
      keywords: ["quorum", "majority", "pigeonhole"],
      components: [],
      prereqIds: ["lamport-clocks"],
    },
    {
      id: "raft-leader-election",
      name: "Raft Leader Election",
      pillarId: "raft-replication",
      topicId: "leader-election",
      summary: "Term-monotonic voting ensuring at most one leader per term.",
      keywords: ["raft", "election", "term"],
      components: [],
      prereqIds: ["quorum-intersection"],
    },
    {
      id: "raft-log-matching",
      name: "Log Matching & Commitment",
      pillarId: "raft-replication",
      topicId: "log-replication",
      summary: "Identical index+term implies identical prefix across replicated logs.",
      keywords: ["appendentries", "commit-index", "linearizability"],
      components: [],
      prereqIds: ["raft-leader-election"],
    },
  ];
}

function buildStructuredPayload(
  props: Set<string>,
  userPrompt: string,
): Record<string, unknown> {
  const hasS1 = /\bS1\b/.test(userPrompt);

  // 1. ScopeCalibrationLlmSchema
  if (props.has("suggestedTitle") && props.has("dimensions")) {
    return {
      suggestedTitle: "Distributed Consensus Systems",
      suggestedIcon: "⚡",
      suggestedDescription:
        "Quorum replication, Raft leader election, and linearizable state machines.",
      suggestedCapabilities: {
        canvas: "architecture",
        calculator: true,
        webResearchDefault: false,
        enableSvgDiagrams: true,
      },
      dimensions: [
        {
          id: "background",
          label: "Starting Level",
          question: "Where should prerequisites begin?",
          options: [
            "Networking & RPC basics",
            "Distributed systems practitioner",
            "Formal verification & TLA+",
          ],
          recommended: "Distributed systems practitioner",
        },
        {
          id: "goal",
          label: "Primary Outcome",
          question: "What capability are you optimizing for?",
          options: [
            "Safety invariants & mental models",
            "Production storage implementation",
            "Incident & partition debugging",
          ],
          recommended: "Safety invariants & mental models",
        },
        {
          id: "emphasis",
          label: "Curriculum Lens",
          question: "Which engineering lens should lead?",
          options: [
            "Quorum tradeoffs & partitions",
            "Throughput & batching pipelines",
            "Multi-region replication",
          ],
          recommended: "Quorum tradeoffs & partitions",
        },
      ],
    };
  }

  // 2. MacroBlueprintLlmSchema (Pass 1)
  if (props.has("identity") && props.has("tutor") && props.has("pillars")) {
    return {
      identity: {
        slug: "distributed-consensus",
        name: "Distributed Consensus Systems",
        description:
          "Quorum replication, Raft leader election, and linearizable state machines.",
        icon: "⚡",
        color: "#006a91",
        tags: ["distributed-systems", "consensus", "raft"],
      },
      capabilities: {
        canvas: "architecture",
        calculator: true,
        webResearchDefault: false,
        enableSvgDiagrams: true,
      },
      tutor: {
        rolePrompt:
          "You are a distributed systems staff engineer guiding learners through consensus invariants.",
        personas: {
          socratic: {
            label: "Invariant Questioner",
            prompt: "Ask which safety invariant breaks under message reorder or partition.",
          },
          eli5: {
            label: "Notebook Analogy",
            prompt: "Explain replicated logs using numbered physical ledgers.",
          },
          strict: {
            label: "Protocol Auditor",
            prompt: "Require exact term, index, and quorum cardinality proofs.",
          },
          devil: {
            label: "Partition Nemesis",
            prompt: "Inject asymmetric network partitions and stale leader scenarios.",
          },
        },
        starterPrompts: [
          "Why cannot Raft commit an entry from a previous term by counting replicas alone?",
        ],
        cardExamples: [
          {
            front: "State the **Log Matching Property** in Raft.",
            back: "If two logs contain an entry with the same `index` and `term`, they are identical through that index.",
          },
        ],
      },
      canvasConfig: null,
      pillars: buildBasePillars(),
    };
  }

  // 3. RefineBlueprintLlmSchema (`identity` + `pillars` + `nodes`, no `tutor`)
  if (props.has("identity") && props.has("pillars") && props.has("nodes")) {
    return {
      identity: {
        slug: "distributed-consensus",
        name: "Distributed Consensus Systems",
        description:
          "Quorum replication, Raft leader election, and linearizable state machines.",
        icon: "⚡",
        color: "#006a91",
        tags: ["distributed-systems", "consensus", "raft"],
      },
      capabilities: {
        canvas: "architecture",
        calculator: true,
        webResearchDefault: false,
        enableSvgDiagrams: true,
      },
      pillars: buildBasePillars(),
      nodes: buildBaseNodes(),
      tracks: [
        {
          id: "core-consensus",
          name: "Core Consensus Path",
          emoji: "⚡",
          description: "From logical clocks to linearizable log replication.",
          targets: ["raft-log-matching"],
        },
      ],
      citedSourceIds: hasS1 ? ["S1"] : [],
    };
  }

  // 4. ConceptGraphPassLlmSchema (Pass 2: `nodes` + `tracks` + `citedSourceIds`)
  if (props.has("nodes") && props.has("tracks") && props.has("citedSourceIds")) {
    return {
      nodes: buildBaseNodes(),
      tracks: [
        {
          id: "core-consensus",
          name: "Core Consensus Path",
          emoji: "⚡",
          description: "From logical clocks to linearizable log replication.",
          targets: ["raft-log-matching"],
        },
      ],
      citedSourceIds: hasS1 ? ["S1"] : [],
    };
  }

  // 5. LivingExpandLlmSchema (`newPillars` + `newNodes`)
  if (props.has("newPillars") && props.has("newNodes")) {
    return {
      newPillars: [
        {
          id: "jepsen-verification",
          name: "Jepsen & Fault Injection",
          shortName: "Jepsen",
          color: "#059669",
          sections: [
            {
              id: "mental-model",
              name: "Core Mental Model",
              icon: "compass",
              promptHint: "Explain linearizability histories and real-time order.",
              ownershipRule: "History verification and anomaly classification.",
            },
            {
              id: "applied-practice",
              name: "Applied Patterns",
              icon: "layers",
              promptHint: "Design nemesis schedules for split-brain and clock skew.",
              ownershipRule: "Fault injection harnesses and checker interpretation.",
            },
          ],
          topics: [
            {
              id: "nemesis-schedules",
              name: "Nemesis Partition Schedules",
              summary: "Deterministic and randomized fault injection for linearizability testing.",
            },
          ],
        },
      ],
      topicAdditionsToExistingPillars: [],
      newNodes: [
        {
          id: "linearizability-checkers",
          name: "Linearizability History Checkers",
          pillarId: "jepsen-verification",
          topicId: "nemesis-schedules",
          summary: "Verifying single-copy atomic order over concurrent invoke/ok histories.",
          keywords: ["jepsen", "knossos", "linearizability"],
          components: [],
          prereqIds: ["raft-log-matching"],
        },
        {
          id: "split-brain-nemesis",
          name: "Asymmetric Partition Nemeses",
          pillarId: "jepsen-verification",
          topicId: "nemesis-schedules",
          summary: "Isolating stale leaders with bridge and majority-ring partitions.",
          keywords: ["nemesis", "partition", "stale-read"],
          components: [],
          prereqIds: ["linearizability-checkers"],
        },
      ],
      newTracks: [
        {
          id: "fault-verification",
          name: "Fault Verification",
          emoji: "🔬",
          description: "Linearizability verification under network partitions.",
          targets: ["split-brain-nemesis"],
        },
      ],
      citedSourceIds: hasS1 ? ["S1"] : [],
    };
  }

  // 6. PillarSeedLlmSchema (`cards` + `drills` + `baselineGuideNotes`)
  if (props.has("cards") && props.has("drills") && props.has("baselineGuideNotes")) {
    const nodeIds = extractMatches(userPrompt, /nodeId="([^"]+)"/g);
    const topicIds = extractMatches(userPrompt, /topicId="([^"]+)"/g);
    const sectionIds = extractMatches(userPrompt, /sectionId="([^"]+)"/g);

    const n0 = nodeIds[0] ?? "lamport-clocks";
    const n1 = nodeIds[1] ?? n0;
    const t0 = topicIds[0] ?? null;
    const s0 = sectionIds[0] ?? null;

    return {
      cards: [
        {
          nodeId: n0,
          topicId: t0,
          sectionId: s0,
          front: `What core safety invariant is enforced by **${n0}**?`,
          back: `It guarantees deterministic state ordering ($Q_1 \\cap Q_2 \\neq \\emptyset$) across concurrent epochs.`,
          prerequisiteCardIndex: null,
        },
        {
          nodeId: n1,
          topicId: t0,
          sectionId: s0,
          front: `How does **${n1}** behave during an asymmetric network partition?`,
          back: `Minority partitions block writes cleanly rather than sacrificing linearizability.`,
          prerequisiteCardIndex: 0,
        },
      ],
      drills: [
        {
          nodeId: n0,
          difficulty: 2,
          prompt: `A 5-node cluster running ${n0} loses connectivity between the leader and 3 followers. Trace how read and write requests behave.`,
          hints: [
            "Count the quorum size required for 5 replicas.",
            "Check whether the isolated leader can confirm a heartbeat round.",
            "Show how the 3-node majority elects a higher-term leader and fences the old leader.",
          ],
          workedSolution:
            "With N=5, majority quorum is 3. The isolated leader (partition of 2) cannot commit writes or serve read-index queries, while the 3-node partition elects a new leader in term T+1.",
          rubricPoints: [
            "Identifies majority quorum size of 3 out of 5 replicas",
            "Explains why isolated old leader cannot commit writes",
            "Describes term fencing upon partition heal",
          ],
        },
      ],
      baselineGuideNotes:
        t0 && s0
          ? [
              {
                topicId: t0,
                sectionId: s0,
                content: `### Invariant Summary\n\n- **${n0}** preserves safety across asynchronous message delays.\n- Always verify majority intersection ($\\lfloor N/2 \\rfloor + 1$) before acknowledging client commits.`,
              },
            ]
          : [],
    };
  }

  // 7. GeneratedDrillLlmSchema (`prompt` + `hints` + `rubricPoints` + `workedSolution`)
  if (
    props.has("prompt") &&
    props.has("hints") &&
    props.has("rubricPoints") &&
    props.has("workedSolution")
  ) {
    return {
      prompt:
        "Explain how quorum intersection prevents split-brain writes in a 5-replica consensus group when two leaders exist in different terms.",
      hints: [
        "Compute the minimum majority size for 5 nodes.",
        "Consider the log completeness check during leader election.",
        "Show that at least one voter in the new term holds the latest committed entry.",
      ],
      rubricPoints: [
        "States majority quorum size (3 of 5)",
        "Applies pigeonhole overlap between commit quorum and election quorum",
        "Connects higher term number to stale-leader rejection",
      ],
      workedSolution:
        "Any write committed in term T reached >=3 replicas, and any leader elected in term T+1 also needs >=3 votes, so at least one voter has the committed entry and enforces term T+1 fencing.",
    };
  }

  // 8. EvaluationResultLlmSchema (anti-sycophancy rubric evaluator: Drills, Feynman, Board Critique)
  if (props.has("extractedClaims") && props.has("factualOrLogicalErrors") && props.has("rubricChecks")) {
    return {
      extractedClaims: [
        "Majority quorums of size floor(N/2)+1 overlap in at least one replica",
        "Term numbers monotonically fence stale leaders upon message contact",
      ],
      factualOrLogicalErrors: [],
      unexplainedJargon: [],
      rubricChecks: [
        {
          point: "Derives core invariant from first principles",
          met: true,
          evidenceOrGap: "Explicitly traced replica overlap and causal ordering.",
        },
        {
          point: "Addresses failure or boundary behavior",
          met: true,
          evidenceOrGap: "Explained minority partition blocking and stale-leader step-down.",
        },
      ],
      socraticFollowUp:
        "How would linearizable reads avoid full log replication overhead while still preventing stale reads from a partitioned leader?",
      constructiveFeedback:
        "Clear, mechanistically grounded explanation with zero hand-wavy buzzwords and accurate invariant reasoning.",
      score: 0.92,
      pass: true,
    };
  }

  // 9. GapCheckLlmSchema (`uncoveredPrerequisites` + `followUpQueries`)
  if (props.has("uncoveredPrerequisites") && props.has("followUpQueries")) {
    return {
      uncoveredPrerequisites: [],
      followUpQueries: [],
    };
  }

  // 10. AI SDK `Output.array(...)` wrapper (`elements`)
  if (props.has("elements")) {
    return {
      elements: [
        "Why does Raft require current-term entries before advancing commitIndex?",
        "Compare ReadIndex vs LeaseRead under clock drift.",
        "Trace a 5-node asymmetric partition recovery.",
      ],
    };
  }

  // 11. Memory extraction (`events`)
  if (props.has("events")) {
    return { events: [] };
  }

  return { ok: true };
}

export async function startMockAiServer(): Promise<MockAiServer> {
  const requests: RecordedAiRequest[] = [];
  const sockets = new Set<import("node:net").Socket>();

  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = (req.url ?? "/").split("?")[0];

    if (method === "GET" && (url === "/v1/models" || url === "/models")) {
      const nowSec = Math.floor(Date.now() / 1000);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: MOCK_MODEL_ID,
              object: "model",
              created: nowSec,
              owned_by: "toolbox-mock-ai",
            },
          ],
        }),
      );
      return;
    }

    if (
      method === "POST" &&
      (url === "/v1/chat/completions" || url === "/chat/completions")
    ) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        let body: ChatCompletionRequestBody = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChatCompletionRequestBody;
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }));
          return;
        }

        const messages = Array.isArray(body.messages) ? body.messages : [];
        const systemPrompt = messages
          .filter((m) => m.role === "system")
          .map((m) => flattenContent(m.content))
          .join("\n");
        const userPrompt = messages
          .filter((m) => m.role === "user")
          .map((m) => flattenContent(m.content))
          .join("\n");

        const schemaProps = Object.keys(
          body.response_format?.json_schema?.schema?.properties ?? {},
        );
        const stream = body.stream === true;
        const model = body.model ?? MOCK_MODEL_ID;

        requests.push({ stream, systemPrompt, userPrompt });

        if (stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          });
          const created = Math.floor(Date.now() / 1000);
          const chunk1 = {
            id: "chatcmpl-mock-stream",
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content:
                    "Quorum intersection guarantees at least one overlapping witness replica across terms.",
                },
                finish_reason: null,
              },
            ],
          };
          const chunk2 = {
            id: "chatcmpl-mock-stream",
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 48,
              completion_tokens: 18,
              total_tokens: 66,
            },
          };
          res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
          res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
          res.end("data: [DONE]\n\n");
          return;
        }

        const content =
          schemaProps.length > 0
            ? JSON.stringify(buildStructuredPayload(new Set(schemaProps), userPrompt))
            : "Deterministic mock assistant completion.";

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: `chatcmpl-mock-${requests.length}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content,
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 64,
              completion_tokens: 128,
              total_tokens: 192,
            },
          }),
        );
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Unhandled mock AI route: ${method} ${url}` } }));
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to bind mockAiServer to loopback port");
  }
  return {
    v1URL: `http://127.0.0.1:${addr.port}/v1`,
    modelId: MOCK_MODEL_ID,
    requests,
    reset() {
      requests.length = 0;
    },
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Registers `mockAi` as an instance-wide custom OpenAI-compatible endpoint and pins
 * `quick`, `deep`, and `research` capabilities to it. On a gated instance, pass an
 * admin's session `Cookie` header so every user inherits the mock AI.
 */
export async function configureInstanceMockAi(
  instance: ToolboxInstance,
  mockAi: MockAiServer,
  headers?: Record<string, string>,
): Promise<void> {
  const ep = await instance.api<{ id: string }>(
    "POST",
    "/endpoints",
    { name: "E2E Mock AI", baseUrl: mockAi.v1URL, apiKey: "mock-e2e-key" },
    headers,
  );
  const modelId = `custom:${ep.id}:${mockAi.modelId}`;
  await instance.api(
    "PUT",
    "/admin/ai-settings",
    {
      capabilities: {
        quick: { mode: "pinned", modelId },
        deep: { mode: "pinned", modelId },
        research: { mode: "pinned", modelId },
      },
    },
    headers,
  );
}

