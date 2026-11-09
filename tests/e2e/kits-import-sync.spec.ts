/**
 * Library Home, Mode 1 (`.toolbox-kit.json`) & Mode 2 (`.toolbox-backup.zip`)
 * Export/Import Round-Trips, Shared Community Library v2 Sync, and New Kit
 * Studio (`/new`) E2E Journeys.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  collectPageErrors,
  expect,
  resetLibrary,
  test,
} from "./fixtures/test.ts";
import { buildEuclideanGeometryKit } from "./fixtures/kits.ts";

test.describe("Kits Library, Import/Export, Shared Sync & Studio", () => {
  test.beforeEach(async ({ instance }) => {
    await resetLibrary(instance);
  });

  test("exports Mode 1 .toolbox-kit.json, imports second custom Kit, and round-trips Mode 2 .toolbox-backup.zip", async ({
    page,
    instance,
  }) => {
    const pageErrors = collectPageErrors(page);

    // 1. Add Official System Design Kit from Library Home onboarding
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "My Study Library" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add System Design Kit" }).click();
    await expect(page).toHaveURL(/\/k\/system-design$/);

    await page.goto("/");
    await expect(page.getByTestId("kit-card-system-design")).toBeVisible();

    // 2. Export Mode 1 (`system-design.toolbox-kit.json`) via real browser download
    await page.getByRole("button", { name: "Export System Design" }).click();
    const kitDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download .toolbox-kit.json" })
      .click();
    const kitDownload = await kitDownloadPromise;
    expect(kitDownload.suggestedFilename()).toBe(
      "system-design.toolbox-kit.json",
    );
    const downloadedKitPath = await kitDownload.path();
    expect(downloadedKitPath).toBeTruthy();
    const exportedKitJson = JSON.parse(
      await readFile(downloadedKitPath!, "utf8"),
    ) as {
      format: string;
      identity: { slug: string; name: string };
    };
    expect(exportedKitJson.format).toBe("toolbox-kit");
    expect(exportedKitJson.identity.slug).toBe("system-design");

    // 3. Import custom second Kit (`Euclidean Geometry`) via ImportKitModal
    const customKitPath = path.join(
      instance.dataDir,
      "euclidean-geometry.toolbox-kit.json",
    );
    await writeFile(
      customKitPath,
      JSON.stringify(buildEuclideanGeometryKit(), null, 2),
      "utf8",
    );

    await page.getByRole("button", { name: "Import Kit / Backup" }).click();
    await page
      .locator('input[type="file"][accept*=".json"]')
      .setInputFiles(customKitPath);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page).toHaveURL(/\/k\/euclidean-geometry$/);

    // Verify both Kits appear together on Library Home (`/`)
    await page.goto("/");
    await expect(page.getByTestId("kit-card-system-design")).toBeVisible();
    await expect(page.getByTestId("kit-card-euclidean-geometry")).toBeVisible();

    // 4. Record personal progress (Guide note + FSRS review) on Euclidean Geometry
    const noteRes = await page.request.put(
      "/api/guide-content/foundations/parallel-postulate/core-postulates",
      {
        headers: { "X-Toolbox-Kit": "euclidean-geometry" },
        data: {
          content:
            "Backup round-trip proof note: Playfair's parallel postulate holds in planar geometry.",
        },
      },
    );
    expect(noteRes.ok()).toBe(true);

    const dueRes = await page.request.get(
      "/api/decks/all/cards/due?kitId=euclidean-geometry",
    );
    expect(dueRes.ok()).toBe(true);
    const dueCards = (await dueRes.json()) as Array<{
      id: string;
      deck_id: string;
    }>;
    expect(dueCards.length).toBeGreaterThan(0);

    const reviewRes = await page.request.post(
      `/api/decks/${dueCards[0].deck_id}/cards/${dueCards[0].id}/review`,
      {
        headers: { "X-Toolbox-Kit": "euclidean-geometry" },
        data: { quality: 5, confidence: "high" },
      },
    );
    expect(reviewRes.ok()).toBe(true);

    await page.reload();
    const egCard = page.getByTestId("kit-card-euclidean-geometry");
    await expect(egCard).toContainText("50% (2 cards)");
    await expect(egCard).toContainText("1/4 (25%)");

    // 5. Export Mode 2 (`euclidean-geometry.toolbox-backup.zip`) via real download
    await page
      .getByRole("button", { name: "Export Euclidean Geometry" })
      .click();
    await page
      .getByRole("button", { name: /Full Personal Backup/i })
      .click();
    const zipDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download .toolbox-backup.zip" })
      .click();
    const zipDownload = await zipDownloadPromise;
    expect(zipDownload.suggestedFilename()).toBe(
      "euclidean-geometry.toolbox-backup.zip",
    );
    const backupZipPath = path.join(
      instance.dataDir,
      "euclidean-geometry.toolbox-backup.zip",
    );
    await zipDownload.saveAs(backupZipPath);

    // 6. Delete Euclidean Geometry and restore from `.toolbox-backup.zip`
    await page
      .getByRole("button", { name: "Delete Euclidean Geometry" })
      .click();
    await page.getByRole("button", { name: "Delete Permanently" }).click();
    await expect(page.getByTestId("kit-card-euclidean-geometry")).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: "Import Kit / Backup" }).click();
    await page
      .locator('input[type="file"][accept*=".zip"]')
      .setInputFiles(backupZipPath);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page).toHaveURL(/\/k\/euclidean-geometry$/);

    await page.goto("/");
    const restoredCard = page.getByTestId("kit-card-euclidean-geometry");
    await expect(restoredCard).toBeVisible();
    await expect(restoredCard).toContainText("50% (2 cards)");
    await expect(restoredCard).toContainText("1/4 (25%)");

    const restoredGuideRes = await page.request.get(
      "/api/guide-content/foundations/parallel-postulate",
      { headers: { "X-Toolbox-Kit": "euclidean-geometry" } },
    );
    expect(restoredGuideRes.ok()).toBe(true);
    const restoredGuide = (await restoredGuideRes.json()) as Record<
      string,
      { content: string }
    >;
    expect(restoredGuide["core-postulates"]?.content).toContain(
      "Backup round-trip proof note",
    );
    expect(pageErrors).toEqual([]);
  });

  test("publishes Euclidean Geometry to Shared Library, forks copy, and syncs v2 update preserving user progress", async ({
    page,
    instance,
  }) => {
    const pageErrors = collectPageErrors(page);

    // Seed v1 Euclidean Geometry
    await instance.api("POST", "/kits/import-kit", {
      skeleton: buildEuclideanGeometryKit({
        version: 1,
        slug: "euclidean-geometry-shared",
        name: "Euclidean Geometry",
      }),
    });

    // 1. Publish v1 via Publish modal in browser
    await page.goto("/");
    await page
      .getByRole("button", { name: "Publish Euclidean Geometry" })
      .click();
    await page
      .getByPlaceholder("What's new or improved in this release?")
      .fill("v1 foundational axioms and right triangles");
    await page
      .getByRole("button", { name: "Publish to Shared Library" })
      .click();

    // 2. Verify published Kit appears in `/shared`
    await page.goto("/shared");
    const sharedCard = page.getByTestId(
      "shared-kit-euclidean-geometry-shared",
    );
    await expect(sharedCard).toBeVisible();
    await expect(sharedCard).toContainText("Euclidean Geometry");

    // 3. Fork a learner copy (`geometry-learner`) and record personal progress on v1
    await instance.api(
      "POST",
      "/shared-kits/euclidean-geometry-shared/fork",
      { customSlug: "geometry-learner" },
    );

    await instance.api(
      "PUT",
      "/guide-content/foundations/parallel-postulate/core-postulates",
      {
        content:
          "Learner personal note: must survive upstream v2 curriculum sync!",
      },
      { "X-Toolbox-Kit": "geometry-learner" },
    );

    const learnerDue = await instance.api<
      Array<{ id: string; deck_id: string }>
    >("GET", "/decks/all/cards/due?kitId=geometry-learner");
    expect(learnerDue.length).toBeGreaterThan(0);
    await instance.api(
      "POST",
      `/decks/${learnerDue[0].deck_id}/cards/${learnerDue[0].id}/review`,
      { quality: 5, confidence: "high" },
      { "X-Toolbox-Kit": "geometry-learner" },
    );

    // 4. Publisher upgrades source Kit to v2 (new topic + node + starter card) and publishes v2
    await instance.api("POST", "/kits/euclidean-geometry-shared/sync", {
      skeleton: buildEuclideanGeometryKit({
        version: 2,
        slug: "euclidean-geometry-shared",
        name: "Euclidean Geometry",
      }),
    });
    await instance.api("POST", "/kits/euclidean-geometry-shared/publish", {
      slug: "euclidean-geometry-shared",
      changelog: "v2 adds Inscribed Angles & Thales' Circle Theorem",
    });

    // 5. Learner opens `/` in browser, sees `Update v2 available`, and clicks `Sync v2`
    await page.goto("/");
    const learnerCard = page.getByTestId("kit-card-geometry-learner");
    await expect(learnerCard).toContainText("Update v2 available");
    await learnerCard.getByRole("button", { name: "Sync v2" }).click();

    // v2 curriculum merged (now 3 topics, 3 cards, v2 badge) AND personal progress preserved!
    await expect(learnerCard).toContainText("2 pillars • 3 topics • v2");
    await expect(learnerCard).toContainText("(3 cards)");

    const { kit: syncedKit } = await instance.api<{
      kit: {
        reviewedCount: number;
        cardCount: number;
        guideFilledCount: number;
      };
    }>("GET", "/kits/geometry-learner");
    expect(syncedKit.cardCount).toBe(3);
    expect(syncedKit.reviewedCount).toBe(1);
    expect(syncedKit.guideFilledCount).toBe(1);

    const preservedNotes = await instance.api<
      Record<string, { content: string }>
    >(
      "GET",
      "/guide-content/foundations/parallel-postulate",
      undefined,
      { "X-Toolbox-Kit": "geometry-learner" },
    );
    expect(preservedNotes["core-postulates"]?.content).toBe(
      "Learner personal note: must survive upstream v2 curriculum sync!",
    );
    expect(pageErrors).toEqual([]);
  });

  test("navigates New Kit Studio (/new) Stage 1 controls and stages pasted syllabus cleanly", async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto("/");
    await page.getByTestId("empty-create-kit-btn").click();
    await expect(page).toHaveURL(/\/new$/);

    const topicInput = page.getByTestId("studio-topic-input");
    await expect(topicInput).toBeVisible();
    await topicInput.fill(
      "Linear Algebra: Vector spaces, eigenvalues, SVD, and spectral theorem.",
    );

    // Depth selector options toggle cleanly
    const quickBtn = page.getByTestId("depth-option-quick");
    const standardBtn = page.getByTestId("depth-option-standard");
    const deepBtn = page.getByTestId("depth-option-deep");

    await expect(standardBtn).toHaveAttribute("aria-pressed", "true");
    await deepBtn.click();
    await expect(deepBtn).toHaveAttribute("aria-pressed", "true");
    await quickBtn.click();
    await expect(quickBtn).toHaveAttribute("aria-pressed", "true");

    // Web research toggle & URL input
    const webToggle = page.getByTestId("studio-web-research-toggle");
    const wasChecked = await webToggle.isChecked();
    await webToggle.click();
    expect(await webToggle.isChecked()).toBe(!wasChecked);

    await page
      .getByTestId("studio-url-input")
      .fill("https://ocw.mit.edu/courses/18-06-linear-algebra");
    await expect(page.getByTestId("studio-add-url-btn")).toBeEnabled();

    // Stage pasted syllabus notes locally
    await page.getByRole("button", { name: "Paste Syllabus" }).click();
    await page
      .getByPlaceholder("Source title (e.g. Course Syllabus / Lecture Notes)")
      .fill("MIT 18.06 Lecture Outline");
    await page
      .getByPlaceholder("Paste raw markdown, lecture outline, or reading notes...")
      .fill(
        "# Week 1: Column Space & Nullspace\nElimination, LU factorization, and rank-nullity theorem.",
      );
    await page.getByRole("button", { name: "Stage Notes" }).click();

    await expect(page.getByTestId("staged-source-0")).toContainText(
      "MIT 18.06 Lecture Outline",
    );

    // Navigate back to Library Home cleanly
    await page.locator("#nav-library").click();
    await expect(page).toHaveURL(/\/$/);
    expect(pageErrors).toEqual([]);
  });
});
