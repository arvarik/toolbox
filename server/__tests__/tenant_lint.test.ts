import { describe, expect, it } from "vitest";
import { scanProject, scanSource } from "../../scripts/tenant-lint.mjs";

describe("tenant-lint static tenancy & boundary gate", () => {
  it("flags unscoped SQL on owned tables including flashcards", () => {
    const bad = scanSource(
      `const row = db.prepare("SELECT * FROM flashcards WHERE id = ?").get(id);`,
      "server/routes/example.ts",
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]?.severity).toBe("unscoped");
    expect(bad[0]?.kind).toBe("sql:flashcards");
  });

  it("accepts ownerId-scoped SQL and valid tenant-lint: allow annotations", () => {
    const scoped = scanSource(
      `const row = db.prepare("SELECT * FROM flashcards WHERE ownerId = ? AND id = ?").get(scope.ownerId, id);`,
      "server/routes/example.ts",
    );
    expect(scoped).toHaveLength(0);

    const allowed = scanSource(
      `// tenant-lint: allow admin cross-user\nconst n = db.prepare("SELECT COUNT(*) FROM decks").get();`,
      "server/routes/example.ts",
    );
    expect(allowed).toHaveLength(0);

    const invalidReason = scanSource(
      `// tenant-lint: allow YOLO\nconst n = db.prepare("SELECT COUNT(*) FROM decks").get();`,
      "server/routes/example.ts",
    );
    expect(invalidReason[0]?.severity).toBe("unknown-reason");
  });

  it("enforces one-way platform->domain boundary and runtime-pure shared/", () => {
    const badPlatform = scanSource(
      `import { ensureDefaultSystemDesignKit } from "../../kits/kitsSchema.ts";`,
      "server/platform/auth/example.ts",
    );
    expect(badPlatform).toHaveLength(1);
    expect(badPlatform[0]?.kind).toBe("boundary:platform-imports-domain");

    const badShared = scanSource(
      `import fs from "node:fs";\nimport React from "react";`,
      "shared/kits/bad.ts",
    );
    expect(badShared).toHaveLength(2);
    expect(badShared[0]?.kind).toBe("boundary:shared-impure-import");
  });

  it("passes cleanly across the entire live server/ and shared/ codebase", () => {
    expect(scanProject(["server", "shared"])).toEqual([]);
  });
});
