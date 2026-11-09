// @vitest-environment node
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOWS_DIR = path.join(ROOT, ".github", "workflows");

// ponytail: line-oriented workflow scanner over stdlib fs; switch to a full YAML parser only if anchors/multiline keys are introduced
function stripComments(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function readWorkflows(): Array<{ file: string; raw: string; body: string }> {
  const files = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();
  return files.map((file) => {
    const raw = fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
    return { file, raw, body: stripComments(raw) };
  });
}

describe("GitHub Actions supply-chain & container config invariants", () => {
  const workflows = readWorkflows();

  it("includes CI, container publish, CodeQL, and OpenSSF Scorecard workflows", () => {
    expect(workflows.map((w) => w.file)).toEqual([
      "ci.yml",
      "codeql.yml",
      "docker-publish.yml",
      "scorecard.yml",
    ]);
  });

  it("pins every uses: action reference to an immutable 40-hex commit SHA", () => {
    const shaPinned = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+@[0-9a-f]{40}$/;

    for (const { file, body } of workflows) {
      const usesLines = [...body.matchAll(/^[\s-]*uses:\s*(.+)$/gm)];
      expect(usesLines.length, `${file} should contain uses: steps`).toBeGreaterThan(0);

      for (const match of usesLines) {
        const ref = match[1]?.split("#")[0]?.trim() ?? "";
        expect(ref, `${file} has unpinned action "${ref}"`).toMatch(shaPinned);
      }
    }
  });

  it("enforces least-privilege top-level permissions and forbids pull_request_target", () => {
    for (const { file, body } of workflows) {
      expect(body, `${file} must never use pull_request_target`).not.toMatch(
        /\bpull_request_target\b/,
      );

      const topPerms =
        /^permissions:\s*read-all\s*$/m.test(body) ||
        /^permissions:\n {2}contents:\s*read\s*$/m.test(body);
      expect(
        topPerms,
        `${file} must declare top-level permissions: contents: read or read-all`,
      ).toBe(true);
    }

    const scorecard = workflows.find((w) => w.file === "scorecard.yml");
    expect(scorecard?.body).toMatch(/^permissions:\s*read-all\s*$/m);
    expect(scorecard?.body).not.toMatch(/^(?:env|defaults):/m);
  });

  it("sets persist-credentials: false on every actions/checkout step", () => {
    for (const { file, body } of workflows) {
      const lines = body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!/uses:\s*actions\/checkout@/.test(lines[i] ?? "")) continue;

        const stepIndent = (lines[i]?.match(/^(\s*)/)?.[1] ?? "").length;
        let stepBlock = "";
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j] ?? "";
          if (!line.trim()) continue;
          const indent = (line.match(/^(\s*)/)?.[1] ?? "").length;
          const isSiblingStep = indent <= stepIndent && line.trimStart().startsWith("- ");
          const isParentKey = indent < stepIndent;
          if (isSiblingStep || isParentKey) break;
          stepBlock += `${line}\n`;
        }

        expect(
          stepBlock,
          `${file}:${i + 1} actions/checkout must set persist-credentials: false`,
        ).toMatch(/\bpersist-credentials:\s*false\b/);
      }
    }
  });

  it("aligns .nvmrc Node major with package.json engines.node and the digest-pinned Dockerfile base", () => {
    const nvmrc = fs.readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim();
    const nvmrcMajor = Number.parseInt(nvmrc, 10);
    expect(Number.isInteger(nvmrcMajor) && nvmrcMajor >= 24).toBe(true);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { engines?: { node?: string } };
    const minEngineMatch = pkg.engines?.node?.match(/^>=(\d+)/);
    expect(minEngineMatch, "package.json engines.node must specify >=major").not.toBeNull();
    expect(nvmrcMajor).toBeGreaterThanOrEqual(Number(minEngineMatch?.[1]));

    const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    const fromRefs = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1] ?? "");
    expect(fromRefs.length).toBeGreaterThan(0);
    for (const ref of fromRefs) {
      expect(ref, "Dockerfile FROM must be node:<.nvmrc major>-<variant>@sha256:<digest>").toMatch(
        new RegExp(`^node:${nvmrcMajor}-[a-z-]+@sha256:[0-9a-f]{64}$`),
      );
    }
  });

  it("verifies multi-arch publish, exact vX.X.X release titling, and container smoke probes", () => {
    const ci = workflows.find((w) => w.file === "ci.yml")?.body ?? "";
    expect(ci).toContain("http://127.0.0.1:3100/api/health");
    expect(ci).toContain("http://127.0.0.1:3100/api/auth/status");

    const publish = workflows.find((w) => w.file === "docker-publish.yml")?.body ?? "";
    expect(publish).toContain("platform: linux/amd64");
    expect(publish).toContain("platform: linux/arm64");
    expect(publish).toContain('--title "$TAG"');
  });

  it("keeps production dependencies exact: every server/shared/CLI external import is in dependencies and pure-client packages stay in devDependencies", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const prodDeps = new Set(Object.keys(pkg.dependencies ?? {}));

    const runtimeFiles: string[] = [
      path.join(ROOT, "scripts", "reset-password.ts"),
      path.join(ROOT, "scripts", "fetch-models.ts"),
    ];
    for (const dir of ["server", "shared"]) {
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (entry.name === "__tests__") continue;
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
            runtimeFiles.push(full);
          }
        }
      };
      walk(path.join(ROOT, dir));
    }

    const builtins = new Set(builtinModules);
    const importedPackages = new Set<string>();
    const specRe =
      /(?:^\s*import\s+(?:type\s+)?(?:\{[\s\S]*?\}|[^"'\n]+?)\s+from\s+|^\s*import\s+|\bimport\s*\(\s*)["'](@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9][a-z0-9._-]*)(?:\/[^"']*)?["']/gm;
    for (const file of runtimeFiles) {
      const content = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const m of content.matchAll(specRe)) {
        const pkgName = m[1] ?? "";
        if (pkgName && !builtins.has(pkgName)) importedPackages.add(pkgName);
      }
    }

    for (const mod of importedPackages) {
      expect(
        prodDeps.has(mod),
        `Server runtime imports "${mod}" which is missing from package.json dependencies`,
      ).toBe(true);
    }
    for (const dep of prodDeps) {
      expect(
        importedPackages.has(dep),
        `package.json dependencies contains "${dep}" which is never imported by server/shared/CLI at runtime (move to devDependencies)`,
      ).toBe(true);
    }

    const pagesTs = fs.readFileSync(
      path.join(ROOT, "server", "platform", "research", "pages.ts"),
      "utf8",
    );
    expect(pagesTs).toContain('from "cheerio/slim"');
  });
});
