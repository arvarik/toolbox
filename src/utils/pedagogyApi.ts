import { request } from "./api";

interface RubricCheckItem {
  point: string;
  met: boolean;
  evidenceOrGap: string;
  quoteOrGap?: string;
}

export interface ImplicitCreditSummary {
  updatedCardIds: string[];
  nodesCredited: string[];
}

export interface RemediationItem {
  cardId: string;
  front?: string;
  nodeId?: string | null;
  nodeName?: string | null;
  reason: string;
}

export interface EvaluationFeedback {
  extractedClaims: string[];
  factualOrLogicalErrors: string[];
  unexplainedJargon: string[];
  rubricChecks: RubricCheckItem[];
  socraticFollowUp: string;
  constructiveFeedback: string;
  score: number;
  pass: boolean;
  hintsUsed?: number;
  viewedWorkedSolution?: boolean;
  assisted?: boolean;
  masteryEligible?: boolean;
}

export interface DrillItem {
  id: string;
  kitId: string;
  nodeId: string;
  nodeName: string;
  difficulty: 1 | 2 | 3;
  prompt: string;
  hints: [string, string, string];
  rubricPoints: string[];
  workedSolution: string;
  seedKey: string | null;
  createdAt: string;
  attemptCount: number;
  bestScore: number | null;
  mastered: boolean;
  lastAttemptAt: string | null;
}

export interface DrillSubmitResult extends EvaluationFeedback {
  attemptId: string;
  drillId: string;
  nodeId: string;
  workedSolution: string;
  implicitCredit: ImplicitCreditSummary;
  implicit_credit_count: number;
  remediation: RemediationItem[];
}

export interface ChallengeNodePayload {
  nodeId: string;
  nodeName: string;
  nodeSummary: string;
  drill: DrillItem;
  feynmanPrompt: string;
  passThreshold: number;
}

export interface ChallengeSubmitResult extends EvaluationFeedback {
  attemptId: string;
  nodeId: string;
  drillId: string;
  committedSectionId: string | null;
  graduatedCardIds: string[];
  implicitCredit: ImplicitCreditSummary;
  implicit_credit_count: number;
}

interface FeynmanEvaluateResult extends EvaluationFeedback {
  conceptName: string;
  nodeId: string | null;
  pillarId: string | null;
  topicId: string | null;
}

export interface CanvasCritiqueResult extends EvaluationFeedback {
  boardId: string;
  kitId: string;
  mode: "concept" | "architecture";
}

export const drillsApi = {
  list: (nodeId?: string) => {
    const qs = nodeId?.trim()
      ? `?nodeId=${encodeURIComponent(nodeId.trim())}`
      : "";
    return request<DrillItem[]>(`/drills${qs}`);
  },
  generate: (payload: {
    nodeId: string;
    difficulty: 1 | 2 | 3;
    model?: string;
  }) =>
    request<DrillItem>("/drills/generate", {
      method: "POST",
      body: payload,
    }),
  submit: (
    id: string,
    payload: {
      submission: string;
      hintsUsed: number;
      viewedWorkedSolution: boolean;
      model?: string;
    },
  ) =>
    request<DrillSubmitResult>(
      `/drills/${encodeURIComponent(id)}/submit`,
      {
        method: "POST",
        body: payload,
      },
    ),
  getChallenge: (nodeId: string, model?: string) => {
    const qs = model?.trim()
      ? `?model=${encodeURIComponent(model.trim())}`
      : "";
    return request<ChallengeNodePayload>(
      `/drills/challenge/${encodeURIComponent(nodeId)}${qs}`,
    );
  },
  submitChallenge: (
    nodeId: string,
    payload: {
      drillId: string;
      drillSubmission: string;
      feynmanExplanation: string;
      model?: string;
    },
  ) =>
    request<ChallengeSubmitResult>(
      `/drills/challenge/${encodeURIComponent(nodeId)}`,
      {
        method: "POST",
        body: payload,
      },
    ),
};

export const feynmanApi = {
  evaluate: (payload: {
    nodeId?: string;
    pillarId?: string;
    topicId?: string;
    conceptName?: string;
    explanation: string;
    model?: string;
  }) =>
    request<FeynmanEvaluateResult>("/feynman/evaluate", {
      method: "POST",
      body: payload,
    }),
};

export const canvasCritiqueApi = {
  critique: (
    boardId: string,
    payload: {
      model?: string;
      goal?: string;
      data?: { nodes: unknown[]; edges: unknown[] };
    } = {},
  ) =>
    request<CanvasCritiqueResult>(
      `/boards/${encodeURIComponent(boardId)}/critique`,
      {
        method: "POST",
        body: payload,
      },
    ),
};
