// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { scanProject, scanSource } from "../../scripts/tenant-lint.mjs";
import { createApp } from "../app.ts";
import {
  getOrInitSecretKey,
  open,
  seal,
  SecretUnavailableError,
  validateSecretKey,
} from "../platform/crypto/secretBox.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";
import { setupTwoTenants } from "./testHelpers.ts";

describe("secretBox AES-256-GCM Sealing & tenant-lint Static Gate", () => {
  it("round-trips UTF-8 secrets with distinct IVs, rejects tampering/wrong keys, and persists secret.key", () => {
    const key = crypto.randomBytes(32);
    const plain = "sk-ant-api03-super-secret-key-🔑";
    const s1 = seal(plain, key);
    const s2 = seal(plain, key);
    expect(s1.startsWith("v1:")).toBe(true);
    expect(s1).not.toBe(s2);
    expect(open(s1, key)).toBe(plain);
    expect(open(s2, key)).toBe(plain);

    const keyB = crypto.randomBytes(32);
    expect(() => open(s1, keyB)).toThrow(SecretUnavailableError);

    const buf = Buffer.from(s1.slice(3), "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => open(`v1:${buf.toString("base64")}`, key)).toThrow(SecretUnavailableError);
    expect(() => open("plaintext-not-sealed", key)).toThrow(SecretUnavailableError);

    expect(() => validateSecretKey("")).not.toThrow();
    expect(() => validateSecretKey("a".repeat(64))).not.toThrow();
    expect(() => validateSecretKey("not-hex")).toThrow(/64-character hex/);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbx-secret-"));
    try {
      const k1 = getOrInitSecretKey(tmpDir);
      const k2 = getOrInitSecretKey(tmpDir);
      expect(k1.length).toBe(32);
      expect(k1.equals(k2)).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "secret.key"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces tenant-lint SQL scoping, allowlist reasons, platform->domain boundary, and clean repo scan", () => {
    const bad = scanSource(
      `const row = db.prepare("SELECT * FROM flashcards WHERE id = ?").get(id);`,
      "server/routes/example.ts",
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]?.severity).toBe("unscoped");
    expect(bad[0]?.kind).toBe("sql:flashcards");

    expect(
      scanSource(
        `const row = db.prepare("SELECT * FROM flashcards WHERE ownerId = ? AND id = ?").get(scope.ownerId, id);`,
        "server/routes/example.ts",
      ),
    ).toHaveLength(0);
    expect(
      scanSource(
        `// tenant-lint: allow admin cross-user\nconst n = db.prepare("SELECT COUNT(*) FROM decks").get();`,
        "server/routes/example.ts",
      ),
    ).toHaveLength(0);
    expect(
      scanSource(
        `// tenant-lint: allow YOLO\nconst n = db.prepare("SELECT COUNT(*) FROM decks").get();`,
        "server/routes/example.ts",
      )[0]?.severity,
    ).toBe("unknown-reason");

    const badPlatform = scanSource(
      `import { ensureDefaultSystemDesignKit } from "../../kits/kitsSchema.ts";`,
      "server/platform/auth/example.ts",
    );
    expect(badPlatform[0]?.kind).toBe("boundary:platform-imports-domain");

    const badShared = scanSource(
      `import fs from "node:fs";\nimport React from "react";`,
      "shared/kits/bad.ts",
    );
    expect(badShared).toHaveLength(2);
    expect(badShared[0]?.kind).toBe("boundary:shared-impure-import");

    expect(scanProject(["server", "shared"])).toEqual([]);
  });
});

describe("Local owner upgrade & tenant isolation", () => {
  let app: Express;

  beforeAll(() => {
    __resetAuthRateLimits();
    app = createApp();
  });

  it("runs local owner mode seamlessly, upgrades via /setup preserving data, and enforces strict tenant isolation", async () => {
    const initialStatus = await request(app).get("/api/auth/status").expect(200);
    expect(initialStatus.body.authRequired).toBe(false);
    expect(initialStatus.body.authenticated).toBe(true);
    expect(initialStatus.body.localOwnerPresent).toBe(true);

    const localDeckRes = await request(app)
      .post("/api/decks")
      .send({ name: "Alice Core Systems", description: "Created before setup" })
      .expect(201);
    const aliceDeckId = localDeckRes.body.id as string;

    const aliceCardRes = await request(app)
      .post(`/api/decks/${aliceDeckId}/cards`)
      .send({ front: "What is quorum?", back: "R + W > N" })
      .expect(201);
    const aliceCardId = aliceCardRes.body.id as string;

    await request(app)
      .put("/api/guide-content/distributed/consensus/overview")
      .send({ content: "Alice private consensus notes" })
      .expect(200);
    await request(app)
      .post("/api/boards")
      .send({ name: "Alice Whiteboard", data: { nodes: [], edges: [] } })
      .expect(201);
    await request(app)
      .post("/api/chat/sessions")
      .send({
        session: {
          id: "shared-session-id",
          name: "Alice Session",
          messages: [{ role: "user", content: "Alice secret prompt" }],
        },
      })
      .expect(200);
    await request(app)
      .put("/api/profile")
      .send({ profileText: "Alice private interview goal" })
      .expect(200);

    const { aliceAgent, bobAgent } = await setupTwoTenants(app, "tenancy");
    await request(app).get("/api/decks").expect(401);

    const aliceDecksAfterSetup = await aliceAgent.get("/api/decks").expect(200);
    expect(aliceDecksAfterSetup.body.some((d: { id: string }) => d.id === aliceDeckId)).toBe(true);

    expect((await bobAgent.get("/api/decks").expect(200)).body).toEqual([]);
    await bobAgent.get(`/api/decks/${aliceDeckId}`).expect(404);
    await bobAgent.put(`/api/decks/${aliceDeckId}/cards/${aliceCardId}/review`).send({ quality: 5 }).expect(404);

    const bobDeckRes = await bobAgent.post("/api/decks").send({ name: "Bob Geometry Prep" }).expect(201);
    const bobCardRes = await bobAgent
      .post(`/api/decks/${bobDeckRes.body.id}/cards`)
      .send({ front: "Pythagorean theorem", back: "a^2 + b^2 = c^2", prerequisite_id: aliceCardId })
      .expect(201);
    expect(bobCardRes.body.prerequisite_id).toBeNull();

    expect((await bobAgent.get("/api/guide-content/distributed/consensus").expect(200)).body).toEqual({});
    expect((await bobAgent.get("/api/boards").expect(200)).body).toEqual([]);
    expect((await bobAgent.get("/api/chat/sessions").expect(200)).body).toEqual({});

    await bobAgent
      .post("/api/chat/sessions")
      .send({
        session: {
          id: "shared-session-id",
          name: "Bob Session",
          messages: [{ role: "user", content: "Bob prompt" }],
        },
      })
      .expect(200);
    const aliceSessionsAfter = await aliceAgent.get("/api/chat/sessions").expect(200);
    expect(aliceSessionsAfter.body["shared-session-id"]?.name).toBe("Alice Session");

    expect((await bobAgent.get("/api/profile").expect(200)).body.profileText).toBe("");
    expect((await aliceAgent.get("/api/search?q=quorum").expect(200)).body.flashcards).toHaveLength(1);

    const bobSearch = await bobAgent.get("/api/search?q=quorum").expect(200);
    expect(bobSearch.body).toMatchObject({ flashcards: [], guideContent: [], boards: [], decks: [] });
  });
});
