import { z } from "zod";

export const GENERATION_CAPABILITIES = ["quick", "deep", "research"] as const;
export type GenerationCapability = (typeof GENERATION_CAPABILITIES)[number];

export const CapabilityModeSchema = z.enum(["auto", "pinned"]);
export type CapabilityMode = z.infer<typeof CapabilityModeSchema>;

export const CapabilityAssignmentSchema = z.object({
  mode: CapabilityModeSchema.default("auto"),
  modelId: z.string().nullable().default(null),
});
export type CapabilityAssignment = z.infer<typeof CapabilityAssignmentSchema>;

export const DEFAULT_CAPABILITY_ASSIGNMENT: CapabilityAssignment = {
  mode: "auto",
  modelId: null,
};

export const CapabilitiesConfigSchema = z.object({
  quick: CapabilityAssignmentSchema.default(DEFAULT_CAPABILITY_ASSIGNMENT),
  deep: CapabilityAssignmentSchema.default(DEFAULT_CAPABILITY_ASSIGNMENT),
  research: CapabilityAssignmentSchema.default(DEFAULT_CAPABILITY_ASSIGNMENT),
});
export type CapabilitiesConfig = z.infer<typeof CapabilitiesConfigSchema>;

/**
 * Per-user capability overrides: ONLY `quick`, `deep`, `research` are allowed.
 * `embeddings` is strictly instance-wide (managed by Admin) so `rag_chunks_vec`
 * shares one coherent vector space across the SQLite database.
 */
export const UserCapabilitiesOverrideSchema = z
  .object({
    quick: CapabilityAssignmentSchema.nullable().optional(),
    deep: CapabilityAssignmentSchema.nullable().optional(),
    research: CapabilityAssignmentSchema.nullable().optional(),
  })
  .strict();
export type UserCapabilitiesOverride = z.infer<
  typeof UserCapabilitiesOverrideSchema
>;

export const EmbeddingsProviderSchema = z.enum([
  "local",
  "gemini",
  "openai",
  "custom",
]);
export type EmbeddingsProvider = z.infer<typeof EmbeddingsProviderSchema>;

export const EmbeddingsConfigSchema = z.object({
  provider: EmbeddingsProviderSchema.default("local"),
  modelId: z.string().min(1).default("Xenova/all-MiniLM-L6-v2"),
  dimension: z.number().int().min(32).max(4096).default(384),
  endpointId: z.string().nullable().default(null),
});
export type EmbeddingsConfig = z.infer<typeof EmbeddingsConfigSchema>;

export const DEFAULT_EMBEDDINGS_CONFIG: EmbeddingsConfig = {
  provider: "local",
  modelId: "Xenova/all-MiniLM-L6-v2",
  dimension: 384,
  endpointId: null,
};

export const WebSearchEngineSchema = z.enum([
  "provider",
  "searxng",
  "combined",
]);
export type WebSearchEngine = z.infer<typeof WebSearchEngineSchema>;

export const WebSearchConfigSchema = z.object({
  engine: WebSearchEngineSchema.default("provider"),
  searxngUrl: z.string().default(""),
});
export type WebSearchConfig = z.infer<typeof WebSearchConfigSchema>;

export const CustomEndpointInputSchema = z.object({
  name: z.string().trim().min(1, "Endpoint name is required").max(80),
  baseUrl: z.string().trim().min(1, "Base URL is required").max(500),
  apiKey: z.string().max(500).optional(),
});
export type CustomEndpointInput = z.infer<typeof CustomEndpointInputSchema>;

export const AdminAiSettingsUpdateSchema = z
  .object({
    capabilities: CapabilitiesConfigSchema.partial().optional(),
    embeddings: EmbeddingsConfigSchema.partial().optional(),
    webSearch: WebSearchConfigSchema.partial().optional(),
    providerKeys: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type AdminAiSettingsUpdate = z.infer<typeof AdminAiSettingsUpdateSchema>;

export const UserByokUpdateSchema = z
  .object({
    providerKeys: z.record(z.string(), z.string()).optional(),
    capabilities: UserCapabilitiesOverrideSchema.optional(),
    webSearchEngine: WebSearchEngineSchema.nullable().optional(),
  })
  .strict();
export type UserByokUpdate = z.infer<typeof UserByokUpdateSchema>;

export interface ModelOptionSummary {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  source: "instance" | "byok";
}

export interface ClientCustomEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  models: Array<{ id: string; upstreamId?: string; name: string }>;
  scope: "instance" | "user";
}

export interface ResolvedCapabilitySummary {
  capability: GenerationCapability;
  mode: CapabilityMode;
  pinnedModelId: string | null;
  resolvedModelId: string | null;
  source: "user_override" | "instance";
}

export interface AdminAiSettingsResponse {
  capabilities: CapabilitiesConfig;
  resolvedCapabilities: Record<GenerationCapability, string | null>;
  embeddings: EmbeddingsConfig;
  embeddingGen: string;
  webSearch: WebSearchConfig;
  providerKeysConfigured: Record<string, boolean>;
  providerKeysMasked: Record<string, string>;
  endpoints: ClientCustomEndpoint[];
  availableModels: ModelOptionSummary[];
}

export interface UserAiSettingsResponse {
  providerKeysConfigured: Record<string, boolean>;
  providerKeysMasked: Record<string, string>;
  customEndpoints: ClientCustomEndpoint[];
  capabilities: Record<GenerationCapability, CapabilityAssignment | null>;
  instanceCapabilities: CapabilitiesConfig;
  resolvedCapabilities: Record<GenerationCapability, ResolvedCapabilitySummary>;
  webSearchEngine: WebSearchEngine | null;
  effectiveWebSearchEngine: WebSearchEngine;
  instanceWebSearch: {
    engine: WebSearchEngine;
    searxngConfigured: boolean;
  };
  embeddings: {
    provider: EmbeddingsProvider;
    modelId: string;
    dimension: number;
    lockedByInstance: true;
  };
  availableModels: ModelOptionSummary[];
}
