// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { createApp } from "../app.ts";
import { sqlite } from "../db.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";
import { resetUserPasswordForCli } from "../../scripts/reset-password.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

describe("OSS Community Hygiene, Build Metadata & Operator Password Recovery CLI", () => {
  let app: Express;

  beforeAll(() => {
    __resetAuthRateLimits();
    app = createApp();
  });

  it("ships required open-source community, security, and supply-chain files matching package.json", () => {
    const requiredFiles = [
      "LICENSE",
      "SECURITY.md",
      "CODE_OF_CONDUCT.md",
      "CONTRIBUTING.md",
      "CHANGELOG.md",
      ".github/dependabot.yml",
      ".github/pull_request_template.md",
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      ".github/ISSUE_TEMPLATE/feature_request.yml",
      ".github/ISSUE_TEMPLATE/config.yml",
    ];

    for (const relPath of requiredFiles) {
      const fullPath = path.join(REPO_ROOT, relPath);
      expect(fs.existsSync(fullPath), `${relPath} should exist`).toBe(true);
      expect(fs.statSync(fullPath).size).toBeGreaterThan(50);
    }

    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    ) as {
      version: string;
      license: string;
      repository?: { url?: string };
      scripts?: Record<string, string>;
    };
    expect(pkg.license).toBe("MIT");
    expect(pkg.repository?.url).toContain("arvarik/toolbox");
    expect(pkg.scripts?.["reset-password"]).toBe(
      "node scripts/reset-password.ts",
    );

    const licenseText = fs.readFileSync(path.join(REPO_ROOT, "LICENSE"), "utf8");
    expect(licenseText).toContain("MIT License");
    expect(licenseText).toContain("Arvind Arikatla");

    const securityText = fs.readFileSync(
      path.join(REPO_ROOT, "SECURITY.md"),
      "utf8",
    );
    expect(securityText).toContain("arvind.arikatla@gmail.com");
    expect(securityText).toContain(
      "https://github.com/arvarik/toolbox/security/advisories/new",
    );
    expect(securityText).toContain("/api/mcp");

    const dependabotText = fs.readFileSync(
      path.join(REPO_ROOT, ".github/dependabot.yml"),
      "utf8",
    );
    expect(dependabotText).toContain("package-ecosystem: npm");
    expect(dependabotText).toContain("package-ecosystem: github-actions");
    expect(dependabotText).toContain("package-ecosystem: docker");
    expect(dependabotText).not.toContain("devcontainers");

    const viteConfigText = fs.readFileSync(
      path.join(REPO_ROOT, "vite.config.ts"),
      "utf8",
    );
    expect(viteConfigText).toContain("import.meta.env.VITE_APP_VERSION");
    expect(import.meta.env.VITE_APP_VERSION).toBe(pkg.version);

    const settingsText = fs.readFileSync(
      path.join(REPO_ROOT, "src/pages/SettingsPage.tsx"),
      "utf8",
    );
    expect(settingsText).toContain("importKitJson");
    expect(settingsText).toContain("importBackupZip");
    expect(settingsText).toContain(
      "Toolbox is a self-hosted, multi-domain active learning and mastery platform.",
    );
  });

  it("keeps docs, .env.example, and shipped artifacts in step with the code", () => {
    const read = (rel: string) =>
      fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const pkg = JSON.parse(read("package.json")) as {
      version: string;
      engines: { node: string };
      scripts: Record<string, string>;
    };

    // Documented Node.js majors and `npm run` scripts match package.json
    const nodeMajor = pkg.engines.node.match(/\d+/)?.[0];
    const docs = [
      "README.md",
      "CONTRIBUTING.md",
      ".github/pull_request_template.md",
      ...fs
        .readdirSync(path.join(REPO_ROOT, "docs"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => `docs/${f}`),
    ];
    for (const doc of docs) {
      const text = read(doc);
      for (const m of text.matchAll(/\bNode(?:\.js)?\s*(?:≥|>=)?\s*(\d+)\b|\bnode:(\d+)-/g)) {
        expect(m[1] ?? m[2], `${doc}: "${m[0]}"`).toBe(nodeMajor);
      }
      for (const [, script] of text.matchAll(/npm run ([\w:-]+)/g)) {
        expect(Object.keys(pkg.scripts), `${doc}: npm run ${script}`).toContain(script);
      }
    }
    expect(read("CHANGELOG.md")).toContain(`## [${pkg.version}]`);

    // Every variable the server reads is documented, and .env.example lists only real ones
    const internalEnv = new Set([
      "VITEST",
      "TOOLBOX_EMBEDDINGS_MOCK",
      "DISABLE_BACKGROUND_JOBS",
      "PUBLIC_ORIGIN",
    ]);
    const serverSource = ["server", "scripts"]
      .flatMap((dir) =>
        fs
          .readdirSync(path.join(REPO_ROOT, dir), { recursive: true, encoding: "utf8" })
          .filter((f) => /\.(?:ts|mjs)$/.test(f) && !f.includes("__tests__"))
          .map((f) => read(path.join(dir, f))),
      )
      .join("\n");
    const deployment = read("docs/deployment.md");
    for (const [, name] of serverSource.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (internalEnv.has(name)) continue;
      expect(deployment, `docs/deployment.md should document ${name}`).toContain(`\`${name}\``);
    }
    for (const [, name] of read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) {
      expect(deployment, `docs/deployment.md should document ${name}`).toContain(`\`${name}\``);
      expect(serverSource, `.env.example lists ${name}, which nothing reads`).toContain(name);
    }

    // Shipped artifacts keep third-party notices and load nothing the CSP blocks
    expect(read("vite.config.ts")).toContain(
      'license: { fileName: "THIRD-PARTY-LICENSES.md" }',
    );
    expect(read("Dockerfile")).toContain("! -iname '*licen[cs]e*' ! -iname '*notice*'");
    expect(read("index.html")).not.toMatch(
      /<(?:link|script)\b[^>]*\b(?:href|src)="(?:https?:)?\/\//,
    );
  });

  it("resetUserPasswordForCli resets password, revokes sessions/tokens, enforces password change, clears lockouts, and rejects unknown accounts", async () => {
    // Rejects empty and unknown usernames cleanly
    await expect(resetUserPasswordForCli("   ")).rejects.toThrow(/required/i);
    await expect(resetUserPasswordForCli("ghost_operator")).rejects.toThrow(
      /Account "ghost_operator" not found/,
    );

    // Rejects passwordless local owner before setup
    await expect(resetUserPasswordForCli("local")).rejects.toThrow(
      /no password to reset/i,
    );

    // Secure the instance as Admin Alice
    const priorSessionAgent = request.agent(app);
    const setupRes = await priorSessionAgent
      .post("/api/auth/setup")
      .send({
        email: "alice@example.com",
        username: "alice",
        displayName: "Alice Operator",
        password: "OriginalOperatorPassword123!",
      })
      .expect(201);
    const aliceId = setupRes.body.user.id as string;

    // Mint a personal API token and confirm both session + token work prior to reset
    await priorSessionAgent.get("/api/decks").expect(200);
    const tokenRes = await priorSessionAgent
      .post("/api/auth/tokens")
      .send({ name: "CLI Recovery Check Token" })
      .expect(201);
    const apiToken = tokenRes.body.token as string;
    await request(app)
      .get("/api/decks")
      .set("Authorization", `Bearer ${apiToken}`)
      .expect(200);

    // Simulate lockout (disabled account) + forgotten password, then recover via CLI helper
    // tenant-lint: allow test simulates operator account lockout on platform users table
    sqlite
      .prepare(
        "UPDATE users SET status = 'disabled', disabledAt = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .run(aliceId);

    const reset = await resetUserPasswordForCli("alice");
    expect(reset.userId).toBe(aliceId);
    expect(reset.username).toBe("alice");
    expect(reset.email).toBe("alice@example.com");
    expect(reset.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    // Prior session and personal token are immediately invalidated
    await priorSessionAgent.get("/api/decks").expect(401);
    await request(app)
      .get("/api/decks")
      .set("Authorization", `Bearer ${apiToken}`)
      .expect(401);

    // Old password no longer authenticates
    __resetAuthRateLimits();
    await request(app)
      .post("/api/auth/login")
      .send({ identifier: "alice", password: "OriginalOperatorPassword123!" })
      .expect(401);

    // Temporary password signs in cleanly and enforces mustChangePassword = 1
    const recoveredAgent = request.agent(app);
    const loginRes = await recoveredAgent
      .post("/api/auth/login")
      .send({ identifier: "alice", password: reset.temporaryPassword })
      .expect(200);
    expect(loginRes.body.user.mustChangePassword).toBe(true);

    const gatedRes = await recoveredAgent.get("/api/decks").expect(403);
    expect(gatedRes.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // Completing password change restores full access
    await recoveredAgent
      .post("/api/auth/change-password")
      .send({
        currentPassword: reset.temporaryPassword,
        newPassword: "RotatedOperatorPassword456!",
      })
      .expect(200);

    await recoveredAgent.get("/api/decks").expect(200);

    // Audit log records CLI reset without leaking the temporary password
    const auditRes = await recoveredAgent
      .get("/api/admin/audit?limit=10")
      .expect(200);
    const serialized = JSON.stringify(auditRes.body.entries);
    expect(serialized).toContain("user.password.reset");
    expect(serialized).not.toContain(reset.temporaryPassword);

    // Unknown username error now lists existing accounts to aid operator recovery
    await expect(resetUserPasswordForCli("typo_admin")).rejects.toThrow(
      /Existing accounts: alice/,
    );

    // Direct CLI invocation (`node scripts/reset-password.ts <email>`) prints temporary password cleanly
    const cliStdout = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts/reset-password.ts"), "ALICE@EXAMPLE.COM"],
      { cwd: REPO_ROOT, env: process.env, encoding: "utf8" },
    );
    expect(cliStdout).toContain("Password reset for alice (alice@example.com):");
    expect(cliStdout).toMatch(/Temporary password: [A-Za-z0-9]{20}/);
  });
});
