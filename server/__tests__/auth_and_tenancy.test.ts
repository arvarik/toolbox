// @vitest-environment node
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { createApp } from "../app.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";

describe("Multi-tenant Auth, Tokens, Invitations, Backups & Tenant Isolation", () => {
  let app: Express;

  beforeAll(() => {
    __resetAuthRateLimits();
    app = createApp();
  });

  it("runs local owner mode seamlessly, upgrades via /setup preserving data, and enforces strict tenant isolation", async () => {
    // 1. Default AUTH_REQUIRED=false: implicit local owner works immediately
    const initialStatus = await request(app).get("/api/auth/status").expect(200);
    expect(initialStatus.body.authRequired).toBe(false);
    expect(initialStatus.body.authenticated).toBe(true);
    expect(initialStatus.body.localOwnerPresent).toBe(true);

    // Create study data across multiple owned tables in implicit local mode
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

    // 2. Secure instance via POST /api/auth/setup -> converts local owner to Admin Alice
    const aliceAgent = request.agent(app);
    const setupRes = await aliceAgent
      .post("/api/auth/setup")
      .send({
        email: "alice@example.com",
        username: "alice",
        displayName: "Alice Admin",
        password: "correct-horse-battery-staple",
      })
      .expect(201);
    expect(setupRes.body.user.username).toBe("alice");
    expect(setupRes.body.user.role).toBe("admin");

    // Unauthenticated callers are now gated with 401
    await request(app).get("/api/decks").expect(401);

    // Alice still owns 100% of her pre-setup study items!
    const aliceDecksAfterSetup = await aliceAgent.get("/api/decks").expect(200);
    expect(
      aliceDecksAfterSetup.body.some((d: { id: string }) => d.id === aliceDeckId),
    ).toBe(true);

    // 3. Personal API tokens (`tbk_...`): read-write vs read-only enforcement + revocation
    const roTokenRes = await aliceAgent
      .post("/api/auth/tokens")
      .send({ name: "ReadOnly MCP", readOnly: true })
      .expect(201);
    const roToken = roTokenRes.body.token as string;
    expect(roToken.startsWith("tbk_")).toBe(true);

    // Read-only token can GET Alice's decks...
    const roDecks = await request(app)
      .get("/api/decks")
      .set("Authorization", `Bearer ${roToken}`)
      .expect(200);
    expect(roDecks.body.length).toBeGreaterThanOrEqual(1);

    // ...but cannot mutate (`403 TOKEN_READ_ONLY`)
    const roWrite = await request(app)
      .post("/api/decks")
      .set("Authorization", `Bearer ${roToken}`)
      .send({ name: "Blocked Deck" })
      .expect(403);
    expect(roWrite.body.error.code).toBe("TOKEN_READ_ONLY");

    // Revoking token immediately invalidates it
    await aliceAgent
      .delete(`/api/auth/tokens/${roTokenRes.body.id}`)
      .expect(200);
    await request(app)
      .get("/api/decks")
      .set("Authorization", `Bearer ${roToken}`)
      .expect(401);

    // 4. Invitation flow -> create Member Bob
    const inviteRes = await aliceAgent
      .post("/api/admin/invitations")
      .send({ email: "bob@example.com", role: "member" })
      .expect(201);
    const inviteToken = new URL(inviteRes.body.link as string).searchParams.get(
      "token",
    )!;
    expect(inviteToken).toBeTruthy();

    const bobAgent = request.agent(app);
    const joinRes = await bobAgent
      .post("/api/auth/accept-invitation")
      .send({
        token: inviteToken,
        email: "bob@example.com",
        username: "bob",
        displayName: "Bob Learner",
        password: "bob-secure-passphrase-123",
      })
      .expect(201);
    expect(joinRes.body.user.role).toBe("member");

    // Bob is forbidden from admin endpoints and instance-wide key/DB exports
    await bobAgent.get("/api/admin/users").expect(403);
    await bobAgent.get("/api/system/export-db").expect(403);
    await bobAgent
      .put("/api/config")
      .send({ gemini_api_key: "unauthorized-override" })
      .expect(403);

    // 5. Strict cross-tenant isolation across every domain route
    const bobDecks = await bobAgent.get("/api/decks").expect(200);
    expect(bobDecks.body).toEqual([]);
    await bobAgent.get(`/api/decks/${aliceDeckId}`).expect(404);
    await bobAgent
      .put(`/api/decks/${aliceDeckId}/cards/${aliceCardId}/review`)
      .send({ quality: 5 })
      .expect(404);

    // Bob creates his own deck and tries to reference Alice's card ID as prerequisite_id -> neutralized to null
    const bobDeckRes = await bobAgent
      .post("/api/decks")
      .send({ name: "Bob Geometry Prep" })
      .expect(201);
    const bobCardRes = await bobAgent
      .post(`/api/decks/${bobDeckRes.body.id}/cards`)
      .send({
        front: "Pythagorean theorem",
        back: "a^2 + b^2 = c^2",
        prerequisite_id: aliceCardId,
      })
      .expect(201);
    expect(bobCardRes.body.prerequisite_id).toBeNull();

    // Guide notes, boards, chat sessions (even with identical session.id!), profile, search, and stats stay isolated
    const bobGuide = await bobAgent
      .get("/api/guide-content/distributed/consensus")
      .expect(200);
    expect(bobGuide.body).toEqual({});

    const bobBoards = await bobAgent.get("/api/boards").expect(200);
    expect(bobBoards.body).toEqual([]);

    const bobSessions = await bobAgent.get("/api/chat/sessions").expect(200);
    expect(bobSessions.body).toEqual({});

    // Bob saves a session with the SAME client ID ("shared-session-id") — must NOT overwrite Alice's!
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
    const aliceSessionsAfter = await aliceAgent
      .get("/api/chat/sessions")
      .expect(200);
    expect(aliceSessionsAfter.body["shared-session-id"]?.name).toBe(
      "Alice Session",
    );

    const bobProfile = await bobAgent.get("/api/profile").expect(200);
    expect(bobProfile.body.profileText).toBe("");

    const aliceSearch = await aliceAgent
      .get("/api/search?q=quorum")
      .expect(200);
    expect(aliceSearch.body.flashcards).toHaveLength(1);

    const bobSearch = await bobAgent
      .get("/api/search?q=quorum")
      .expect(200);
    expect(bobSearch.body.flashcards).toEqual([]);
    expect(bobSearch.body.guideContent).toEqual([]);
    expect(bobSearch.body.boards).toEqual([]);
    expect(bobSearch.body.decks).toEqual([]);

    // 6. Online SQLite backup + Audit Log verification (Admin Alice)
    const backupRes = await aliceAgent.post("/api/admin/backups").expect(201);
    expect(backupRes.body.backup.filename).toMatch(/\.db$/);
    expect(backupRes.body.backup.sizeBytes).toBeGreaterThan(0);

    const auditRes = await aliceAgent
      .get("/api/admin/audit?limit=20")
      .expect(200);
    expect(auditRes.body.entries.length).toBeGreaterThan(0);
    const serializedAudit = JSON.stringify(auditRes.body.entries);
    expect(serializedAudit).not.toContain("correct-horse-battery-staple");
    expect(serializedAudit).not.toContain(roToken);
  });
});
