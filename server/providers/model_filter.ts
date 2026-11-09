export const RECENCY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

const NON_CHAT_PATTERNS = [
  /embed/i,
  /whisper/i,
  /\btts\b|-tts/i,
  /transcribe/i,
  /-audio/i,
  /realtime/i,
  /speech/i,
  /dall-?e/i,
  /imagen/i,
  /veo/i,
  /-image/i,
  /image-generation/i,
  /banana/i,
  /moderation/i,
  /guard/i,
  /lyria/i,
  /robotics/i,
  /computer-use/i,
  /deep-research/i,
  /antigravity/i,
  /babbage/i,
  /davinci/i,
  /-instruct/i,
  /search-preview/i,
  /\baqa\b/i,
];

export function isChatModel(modelId: string | undefined | null): boolean {
  if (!modelId) return false;
  return !NON_CHAT_PATTERNS.some((re) => re.test(modelId));
}

export function isWithinRecencyWindow(
  releasedAtMs: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (releasedAtMs === null || releasedAtMs === undefined) return true;
  return nowMs - releasedAtMs <= RECENCY_WINDOW_MS;
}

const SNAPSHOT_SUFFIX_RE = /[-@](\d{4}-\d{2}-\d{2}|\d{8}|\d{3,4})$/;

export function baseAliasOf(modelId: string): string {
  return modelId.replace(SNAPSHOT_SUFFIX_RE, "");
}

export function dedupeAliases<T extends { id: string }>(models: readonly T[]): T[] {
  const ids = new Set(models.map((m) => m.id));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    const base = baseAliasOf(model.id);
    if (base !== model.id && ids.has(base)) continue;
    result.push(model);
  }
  return result;
}

export function applyCatalogGuardrails<
  T extends { id: string; releasedAt?: number | null },
>(models: readonly T[], nowMs: number = Date.now()): T[] {
  const filtered = models.filter(
    (m) => isChatModel(m.id) && isWithinRecencyWindow(m.releasedAt, nowMs),
  );
  return dedupeAliases(filtered);
}

export function inferModelFamily(
  providerId: string,
  modelId: string | undefined | null,
): string | null {
  const id = (modelId || "").toLowerCase();
  if (providerId === "gemini") {
    if (id.startsWith("gemma")) return "Gemma";
    if (!id.startsWith("gemini")) return null;
    if (id.includes("flash-lite")) return "Flash-Lite";
    if (id.includes("flash")) return "Flash";
    if (id.includes("pro")) return "Pro";
    return null;
  }
  if (providerId === "claude") {
    if (id.includes("fable")) return "Fable";
    if (id.includes("opus")) return "Opus";
    if (id.includes("sonnet")) return "Sonnet";
    if (id.includes("haiku")) return "Haiku";
    return null;
  }
  if (providerId === "openai") {
    if (id.includes("-sol")) return "Flagship";
    if (id.includes("-terra")) return "Balanced";
    if (id.includes("-luna")) return "Fast";
    if (id.includes("nano")) return "Nano";
    if (id.includes("mini")) return "Mini";
    if (/^o\d/.test(id)) return "Reasoning";
    if (id.includes("codex")) return "Codex";
    if (id.startsWith("chatgpt")) return "Chat";
    if (id.startsWith("gpt")) return "Flagship";
    return null;
  }
  return null;
}

const FAMILY_ORDER: Record<string, string[]> = {
  gemini: ["Pro", "Flash", "Flash-Lite", "Gemma"],
  claude: ["Fable", "Opus", "Sonnet", "Haiku"],
  openai: [
    "Flagship",
    "Balanced",
    "Fast",
    "Mini",
    "Nano",
    "Reasoning",
    "Codex",
    "Chat",
  ],
};

export function extractGeneration(
  modelId: string | undefined | null,
): number | null {
  if (!modelId) return null;
  const base = baseAliasOf(modelId).replace(/(\d)-(\d)/g, "$1.$2");
  const match = base.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  return Number.isNaN(value) ? null : value;
}

const PREVIEW_VARIANT_RE = /preview|exp\b|experimental|-latest\b|latest$/i;

export function isPreviewVariant(modelId: string | undefined | null): boolean {
  return PREVIEW_VARIANT_RE.test(modelId || "");
}

export function keepLatestPerFamily<T extends { id: string }>(
  providerId: string,
  models: readonly T[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const model of models) {
    const family = inferModelFamily(providerId, model.id);
    const key = family ?? "__other__";
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(model);
  }

  const order = FAMILY_ORDER[providerId] || [];
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const ia =
      a === "__other__"
        ? Infinity
        : order.indexOf(a) === -1
          ? order.length
          : order.indexOf(a);
    const ib =
      b === "__other__"
        ? Infinity
        : order.indexOf(b) === -1
          ? order.length
          : order.indexOf(b);
    return ia - ib;
  });

  const result: T[] = [];
  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    if (key === "__other__") {
      result.push(...group);
      continue;
    }
    const versioned = group.filter((m) => extractGeneration(m.id) !== null);
    let kept: T[];
    if (versioned.length > 0) {
      const maxGen = Math.max(
        ...versioned.map((m) => extractGeneration(m.id) ?? 0),
      );
      kept = versioned.filter((m) => extractGeneration(m.id) === maxGen);
      const stable = kept.filter((m) => !isPreviewVariant(m.id));
      if (stable.length > 0) kept = stable;
    } else {
      kept = group;
    }
    kept = kept.filter(
      (m) =>
        !kept.some((other) => other !== m && m.id.startsWith(`${other.id}-`)),
    );
    result.push(...kept);
  }
  return result;
}

export function prettyModelName(modelId: string | undefined | null): string {
  if (!modelId) return "";
  const cleaned = modelId.replace(/^models\//, "");
  return cleaned
    .split(/[-_:/]/)
    .filter(Boolean)
    .map((part) => {
      if (/^gpt/i.test(part)) return part.toUpperCase();
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
