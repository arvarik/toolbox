import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";
import type { KitDetailItem } from "../stores/useKitStore";

export type CompilerDepth = "quick" | "standard" | "deep";

export interface StagedSourceSummary {
  stagedId: string;
  kind: "pdf" | "markdown" | "text" | "url";
  title: string;
  url: string | null;
  mimeType: string | null;
  sizeBytes: number;
  wordCount: number;
  excerpt: string;
  safeBasename: string | null;
}

export interface ScopeDimension {
  id: string;
  label: string;
  question: string;
  options: string[];
  recommended: string;
}

export interface ScopeCalibrationResult {
  suggestedTitle: string;
  suggestedIcon: string;
  suggestedDescription: string;
  suggestedCapabilities: KitSkeletonV1["capabilities"];
  dimensions: [ScopeDimension, ScopeDimension, ScopeDimension];
}

export interface VerifiedSourceEntry {
  id: string;
  kind: "pdf" | "markdown" | "text" | "url" | "web";
  title: string;
  url: string | null;
  note: string | null;
  excerpt: string;
}

export interface VerifiedSourcePool {
  entries: VerifiedSourceEntry[];
  gapCheckQueries: string[];
}

export interface DagRepairReport {
  initialCyclicSccCount: number;
  llmRepairAttempted: boolean;
  tieBreakerDroppedCount: number;
}

export interface CompileKitResponse {
  skeleton: KitSkeletonV1;
  pool: VerifiedSourcePool;
  citedSourceIds: string[];
  dagRepair: DagRepairReport;
  stagedSources: StagedSourceSummary[];
}

export interface CommitKitResponse {
  kit: KitDetailItem;
  jobId: string;
  committedSourceIds: string[];
}

export interface KitSeedStatusResponse {
  kitId: string;
  slug: string;
  status: string;
  statusDetail: string | null;
  cardCount: number;
  drillCount: number;
  guideFilledCount: number;
  job: {
    id: string;
    status: string;
    attempts: number;
    lastError: string | null;
    progress: {
      totalPillars: number;
      completedPillarIds: string[];
      currentPillarId: string | null;
      addedCards: number;
      addedDrills: number;
      addedGuideNotes: number;
    };
  } | null;
}

export interface ExpandKitResponse {
  kit: KitDetailItem;
  jobId: string | null;
  addedPillarIds: string[];
  addedTopicIds: string[];
  addedNodeIds: string[];
  committedSourceIds: string[];
  dagRepair: DagRepairReport;
}

async function requestCompilerJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };

  const res = await fetch(`/api/compiler${path}`, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      code?: string;
    };
    const err = new Error(
      errBody.error || errBody.message || `Compiler request failed (${res.status})`,
    ) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = errBody.code;
    throw err;
  }

  return (await res.json()) as T;
}

export const compilerApi = {
  uploadSources(files: File[]): Promise<{ sources: StagedSourceSummary[] }> {
    const form = new FormData();
    for (const f of files) {
      form.append("files", f);
    }
    return requestCompilerJson("/sources", {
      method: "POST",
      body: form,
    });
  },

  ingestUrlOrText(payload: {
    url?: string;
    urls?: string[];
    text?: string;
    title?: string;
  }): Promise<{ sources: StagedSourceSummary[] }> {
    return requestCompilerJson("/sources", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  deleteSource(stagedId: string): Promise<{ ok: boolean }> {
    return requestCompilerJson(`/sources/${encodeURIComponent(stagedId)}`, {
      method: "DELETE",
    });
  },

  calibrate(payload: {
    topicPrompt: string;
    depth?: CompilerDepth;
    stagedSourceIds?: string[];
    urls?: string[];
    pastedText?: string;
    pastedTitle?: string;
  }): Promise<{
    calibration: ScopeCalibrationResult;
    stagedSources: StagedSourceSummary[];
  }> {
    return requestCompilerJson("/calibrate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  compile(payload: {
    topicPrompt: string;
    depth?: CompilerDepth;
    stagedSourceIds?: string[];
    urls?: string[];
    pastedText?: string;
    pastedTitle?: string;
    enableWebResearch?: boolean;
    suggestedTitle?: string;
    suggestedIcon?: string;
    suggestedDescription?: string;
    suggestedCapabilities?: Partial<KitSkeletonV1["capabilities"]>;
    calibrationAnswers?: Record<string, string>;
    customInstructions?: string;
  }): Promise<CompileKitResponse> {
    return requestCompilerJson("/compile", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  refine(payload: {
    skeleton: KitSkeletonV1;
    instruction: string;
    stagedSourceIds?: string[];
    pool?: VerifiedSourcePool;
  }): Promise<{
    skeleton: KitSkeletonV1;
    citedSourceIds: string[];
    dagRepair: DagRepairReport;
  }> {
    return requestCompilerJson("/refine", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  commit(payload: {
    skeleton: KitSkeletonV1;
    stagedSourceIds?: string[];
  }): Promise<CommitKitResponse> {
    return requestCompilerJson("/commit", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getSeedStatus(slugOrId: string): Promise<KitSeedStatusResponse> {
    return requestCompilerJson(
      `/kits/${encodeURIComponent(slugOrId)}/seed-status`,
    );
  },

  expandKit(
    slugOrId: string,
    payload: {
      prompt: string;
      stagedSourceIds?: string[];
      urls?: string[];
      pastedText?: string;
      pastedTitle?: string;
      enableWebResearch?: boolean;
    },
  ): Promise<ExpandKitResponse> {
    return requestCompilerJson(`/kits/${encodeURIComponent(slugOrId)}/expand`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

export default compilerApi;
