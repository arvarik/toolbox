import { describe, expect, it } from "vitest";
import {
  verifyKitSkeleton,
  type KitSkeletonV1,
} from "../../shared/kits/kitSkeleton.ts";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";

function cloneSkeleton(): KitSkeletonV1 {
  return structuredClone(SYSTEM_DESIGN_KIT_SKELETON);
}

describe("KitSkeletonV1Schema & verifyKitSkeleton()", () => {
  it("verifies the canonical System Design Starter Kit skeleton", () => {
    const verified = verifyKitSkeleton(SYSTEM_DESIGN_KIT_SKELETON);
    expect(verified.identity.slug).toBe("system-design");
    expect(verified.pillars).toHaveLength(7);
    expect(verified.graph.nodes.length).toBeGreaterThanOrEqual(55);
    expect(verified.graph.tracks).toHaveLength(6);
    expect(verified.seeds.starterDeck?.cards).toHaveLength(15);
  });

  it("rejects cycles and self-loops in the prerequisite DAG", () => {
    const selfLoop = cloneSkeleton();
    const firstId = selfLoop.graph.nodes[0]!.id;
    selfLoop.graph.edges.push({ from: firstId, to: firstId });
    expect(() => verifyKitSkeleton(selfLoop)).toThrow(/Self-loop/);

    const cyclic = cloneSkeleton();
    const e0 = cyclic.graph.edges[0]!;
    cyclic.graph.edges.push({ from: e0.to, to: e0.from });
    expect(() => verifyKitSkeleton(cyclic)).toThrow(/Cycle detected/);
  });

  it("rejects dangling pillar/topic slugs and starter card references", () => {
    const badNodeTopic = cloneSkeleton();
    badNodeTopic.graph.nodes[0]!.topicId = "non-existent-topic";
    expect(() => verifyKitSkeleton(badNodeTopic)).toThrow(/unknown topic/);

    const badCardNode = cloneSkeleton();
    badCardNode.seeds.starterDeck!.cards[0]!.nodeId = "ghost-node";
    expect(() => verifyKitSkeleton(badCardNode)).toThrow(/unknown node/);

    const badPrereqKey = cloneSkeleton();
    badPrereqKey.seeds.starterDeck!.cards[0]!.prerequisiteKey = "missing-card";
    expect(() => verifyKitSkeleton(badPrereqKey)).toThrow(
      /unknown prerequisiteKey/,
    );
  });
});
