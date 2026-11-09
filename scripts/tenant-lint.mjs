#!/usr/bin/env node
// tenant-lint:
// 1. Finds SQL over owned tables in server/**/*.ts that carries no `ownerId` or
//    `ownerTok` predicate (adapted from Contrack's tenant-lint).
// 2. Enforces our 1-way modularity boundary: `server/platform/**` and
//    `shared/platform/**` must NEVER import domain modules (`kits/`, `srs/`,
//    `compiler/`, `graph/`), and `shared/**` must stay runtime-pure (zero
//    `node:*` or `react` imports).

import fs from "node:fs";
import path from "node:path";

/** Tables with an `ownerId` column holding tenant-owned rows. */
export const OWNED_TABLES = [
  "kits",
  "guide_content",
  "chat_starters",
  "decks",
  "flashcards",
  "remediation_queue",
  "drills",
  "drill_attempts",
  "boards",
  "chat_sessions",
  "kit_sources",
  "kit_source_chunks",
  "episodic_memory",
  "study_sessions",
  "user_learning_profile",
  "user_ai_settings",
  "rag_chunks",
];

/** Virtual tables partitioned by owner (`ownerTok` or `ownerId`). */
export const VIRTUAL_TABLES = [
  "flashcards_fts",
  "guide_content_fts",
  "kit_source_chunks_fts",
  "episodic_memory_fts",
  "rag_chunks_fts",
  "rag_chunks_vec",
];

/** Allowed justification reasons in `// tenant-lint: allow <reason>`. */
export const ALLOWED_REASONS = [
  "instance sweep",
  "owner-checked by caller",
  "boot migration",
  "admin cross-user",
  "derived table",
];

const ALL_TABLES = [...OWNED_TABLES, ...VIRTUAL_TABLES];
const TABLE_RE = new RegExp(
  `\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(${ALL_TABLES.join("|")})\\b`,
  "i",
);

const ENDS_EXPRESSION = /[\w$)\]"'`]/;
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

function extractLiterals(source) {
  const out = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  let prev = "";
  let word = "";

  const remember = (ch) => {
    if (/\s/.test(ch)) return;
    if (/[\w$]/.test(ch)) word += ch;
    else word = "";
    prev = ch;
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (
      c === "/" &&
      (!ENDS_EXPRESSION.test(prev) ||
        (/[\w$]/.test(prev) && REGEX_KEYWORDS.has(word)))
    ) {
      const start = i;
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const ch = source[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "\n") break;
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (closed) {
        while (j < n && /[a-z]/.test(source[j])) j++;
        i = j;
        prev = "/";
        word = "";
        continue;
      }
      i = start;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const startLine = line;
      let value = "";
      i++;
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          value += ch + (source[i + 1] ?? "");
          if (source[i + 1] === "\n") line++;
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        if (ch === "\n") line++;
        value += ch;
        i++;
      }
      out.push({ value, line: startLine });
      prev = quote;
      word = "";
      continue;
    }
    remember(c);
    i++;
  }
  return out;
}

function allowAbove(lines, lineNumber) {
  for (let i = lineNumber - 2; i >= 0 && i >= lineNumber - 3; i--) {
    const text = (lines[i] ?? "").trim();
    const m = text.match(/^\/\/\s*tenant-lint:\s*allow\s+(.+?)\s*$/);
    if (m) return m[1];
    if (text !== "" && !text.startsWith("//")) break;
  }
  return null;
}

const IMPORT_RE =
  /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;

export function scanBoundaries(source, file) {
  const findings = [];
  const normalized = file.replace(/\\/g, "/");
  const isPlatform =
    normalized.startsWith("server/platform/") ||
    normalized.startsWith("shared/platform/");
  const isShared = normalized.startsWith("shared/");

  if (!isPlatform && !isShared) return findings;

  const lines = source.split("\n");
  lines.forEach((text, idx) => {
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(text)) !== null) {
      const spec = m[1];
      if (
        isPlatform &&
        /(?:^|\/)(?:kits|srs|compiler|graph|src)(?:\/|$)/.test(spec)
      ) {
        findings.push({
          file,
          line: idx + 1,
          kind: "boundary:platform-imports-domain",
          severity: "boundary",
          reason: null,
          text: `platform module imports domain path "${spec}"`,
        });
      }
      if (
        isShared &&
        (/^node:/.test(spec) ||
          /^(?:fs|path|crypto|http|https|os|stream|zlib|better-sqlite3|express|react|react-dom)(?:\/|$)/.test(
            spec,
          ))
      ) {
        findings.push({
          file,
          line: idx + 1,
          kind: "boundary:shared-impure-import",
          severity: "boundary",
          reason: null,
          text: `shared/ module imports runtime-specific package "${spec}"`,
        });
      }
    }
  });
  return findings;
}

export function scanSource(source, file = "<memory>") {
  const findings = [...scanBoundaries(source, file)];
  const normalized = file.replace(/\\/g, "/");
  if (!normalized.startsWith("server/")) return findings;

  const lines = source.split("\n");
  for (const lit of extractLiterals(source)) {
    const m = lit.value.match(TABLE_RE);
    if (!m) continue;
    // Skip pure DDL (`CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `CREATE INDEX`).
    const withoutSqlComments = lit.value.replace(/^\s*(?:--[^\n]*\n\s*)*/g, "");
    if (/^\s*(?:CREATE|ALTER|DROP)\s+/i.test(withoutSqlComments)) continue;

    const hasOwner = /ownerId|ownerTok/.test(lit.value);
    const reason = allowAbove(lines, lit.line);

    if (reason !== null && !ALLOWED_REASONS.includes(reason)) {
      findings.push({
        file,
        line: lit.line,
        kind: `sql:${m[1].toLowerCase()}`,
        severity: "unknown-reason",
        reason,
        text: lit.value.trim().slice(0, 120).replace(/\s+/g, " "),
      });
      continue;
    }
    if (hasOwner || reason !== null) continue;
    findings.push({
      file,
      line: lit.line,
      kind: `sql:${m[1].toLowerCase()}`,
      severity: "unscoped",
      reason: null,
      text: lit.value.trim().slice(0, 120).replace(/\s+/g, " "),
    });
  }

  return findings;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walk(full, acc);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

export function scanProject(roots = ["server", "shared"]) {
  const findings = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      findings.push(...scanSource(fs.readFileSync(file, "utf8"), file));
    }
  }
  return findings;
}

export function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/|\*\*|\*/g, (m) =>
      m === "**/" ? "(?:[^/]*\\/)*" : m === "**" ? ".*" : "[^/]*",
    );
  return new RegExp(`^${escaped}$`);
}

function main(argv) {
  const strictIndex = argv.indexOf("--strict");
  const strict = strictIndex !== -1;
  const globs = strict
    ? argv.slice(strictIndex + 1).filter((a) => !a.startsWith("--"))
    : [];
  const findings = scanProject(["server", "shared"]);

  if (strict) {
    const effectiveGlobs =
      globs.length > 0 ? globs : ["server/**/*.ts", "shared/**/*.ts"];
    const patterns = effectiveGlobs.map((g) => globToRegExp(g));
    // Always include boundary checks on shared/**/*.ts as well
    const sharedPattern = globToRegExp("shared/**/*.ts");
    const inScope = findings.filter(
      (f) =>
        patterns.some((re) => re.test(f.file.replace(/\\/g, "/"))) ||
        sharedPattern.test(f.file.replace(/\\/g, "/")),
    );
    for (const f of inScope) {
      console.error(`${f.file}:${f.line}  ${f.severity}  ${f.kind}  ${f.text}`);
    }
    if (inScope.length) {
      console.error(
        `\ntenant-lint: ${inScope.length} problem(s) found.`,
      );
      process.exit(1);
    }
    console.log(
      `tenant-lint: clean (${effectiveGlobs.join(", ")}, shared/**/*.ts)`,
    );
    return;
  }

  for (const f of findings) {
    console.log(`${f.file}:${f.line}  ${f.severity}  ${f.kind}  ${f.text}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main(process.argv.slice(2));
}
