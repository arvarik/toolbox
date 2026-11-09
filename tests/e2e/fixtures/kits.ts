/**
 * Deterministic `KitSkeletonV1` fixtures for multi-Kit E2E journeys.
 */
import {
  verifyKitSkeleton,
  type KitSkeletonV1,
} from "../../../shared/kits/kitSkeleton.ts";

export function buildEuclideanGeometryKit(
  options: {
    version?: number;
    slug?: string;
    name?: string;
    includeStarterContent?: boolean;
  } = {},
): KitSkeletonV1 {
  const version = options.version ?? 1;
  const slug = options.slug ?? "euclidean-geometry";
  const name = options.name ?? "Euclidean Geometry";
  const includeSeeds = options.includeStarterContent ?? true;

  const v2Topics =
    version >= 2
      ? [
          {
            id: "inscribed-angles",
            name: "Inscribed Angles & Chords",
            summary: "Circle theorems and Thales' theorem added in v2.",
          },
        ]
      : [];

  const v2Nodes =
    version >= 2
      ? [
          {
            id: "thales-circle-theorem",
            name: "Thales' Circle Theorem",
            pillarId: "triangles-circles",
            topicId: "inscribed-angles",
            summary:
              "An angle inscribed across a circle's diameter is always a right angle.",
            keywords: ["thales", "diameter", "inscribed"],
            components: [],
          },
        ]
      : [];

  const v2Edges =
    version >= 2
      ? [{ from: "triangle-congruence", to: "thales-circle-theorem" }]
      : [];

  const v2Cards =
    version >= 2
      ? [
          {
            key: "eg-card-thales",
            front:
              "What angle is subtended by diameter $AB$ at any point $C$ on the circle?",
            back: "A **right angle** ($90^\\circ$).",
            nodeId: "thales-circle-theorem",
            pillarId: "triangles-circles",
            topicId: "inscribed-angles",
            sectionId: "theorems",
          },
        ]
      : [];

  return verifyKitSkeleton({
    format: "toolbox-kit",
    schemaVersion: 1,
    exportedAt: "2026-01-15T00:00:00.000Z",

    identity: {
      slug,
      name,
      description:
        "Axiomatic plane geometry, triangle congruence, and classical proofs.",
      icon: "📐",
      color: "#0f766e",
      version,
      author: "Euclid of Alexandria",
      tags: ["mathematics", "geometry", "proofs"],
    },

    capabilities: {
      canvas: "concept",
      calculator: true,
      webResearchDefault: false,
      enableSvgDiagrams: true,
    },

    tutor: {
      rolePrompt:
        "You are a rigorous Euclidean geometry tutor guiding proofs from first principles.",
      personas: {
        socratic: {
          label: "Socratic Geometer",
          prompt: "Guide proofs with targeted geometric questions.",
        },
        eli5: {
          label: "Visual Intuition",
          prompt: "Explain geometric truths using paper-folding intuition.",
        },
        strict: {
          label: "Axiomatic Examiner",
          prompt: "Require explicit postulate citations for every step.",
        },
        devil: {
          label: "Non-Euclidean Challenger",
          prompt: "Probe where spherical or hyperbolic geometry diverges.",
        },
      },
      starterPrompts: [
        "Why does SAS congruence require the included angle?",
      ],
      cardExamples: [
        {
          front: "State Playfair's Axiom.",
          back: "At most one parallel line passes through an external point.",
        },
      ],
    },

    pillars: [
      {
        id: "foundations",
        number: 1,
        name: "Axiomatic Foundations",
        shortName: "Axioms",
        color: "#0f766e",
        sections: [
          {
            id: "core-postulates",
            name: "Core Postulates",
            icon: "book-open",
            promptHint: "State axioms clearly.",
            ownershipRule: "Incidence and parallel axioms.",
          },
          {
            id: "proof-patterns",
            name: "Proof Patterns",
            icon: "layers",
            promptHint: "Outline construction strategies.",
            ownershipRule: "Auxiliary line techniques.",
          },
        ],
        topics: [
          {
            id: "parallel-postulate",
            name: "Parallel Postulate & Angles",
            summary: "Transversals, alternate interior angles, and angle sums.",
          },
        ],
      },
      {
        id: "triangles-circles",
        number: 2,
        name: "Triangles & Circles",
        shortName: "Triangles",
        color: "#2563eb",
        sections: [
          {
            id: "theorems",
            name: "Key Theorems",
            icon: "target",
            promptHint: "State necessary and sufficient conditions.",
            ownershipRule: "Congruence and metric theorems.",
          },
          {
            id: "constructions",
            name: "Compass Constructions",
            icon: "cpu",
            promptHint: "Straightedge and compass steps.",
            ownershipRule: "Classical constructions.",
          },
        ],
        topics: [
          {
            id: "right-triangles",
            name: "Right Triangles & Area Proofs",
            summary: "Congruence criteria and area-preserving rearrangements.",
          },
          ...v2Topics,
        ],
      },
    ],

    graph: {
      nodes: [
        {
          id: "axioms-postulates",
          name: "Euclid's Five Postulates",
          pillarId: "foundations",
          topicId: "parallel-postulate",
          summary:
            "Foundational incidence and parallel axioms of planar geometry.",
          keywords: ["postulate", "parallel", "axiom"],
          components: [],
        },
        {
          id: "triangle-congruence",
          name: "Triangle Congruence (SAS, ASA, SSS)",
          pillarId: "triangles-circles",
          topicId: "right-triangles",
          summary: "Sufficient conditions for two triangles to be isometric.",
          keywords: ["congruence", "sas", "sss"],
          components: [],
        },
        {
          id: "pythagorean-theorem",
          name: "Pythagorean Theorem",
          pillarId: "triangles-circles",
          topicId: "right-triangles",
          summary:
            "In a right triangle, the square on the hypotenuse equals the sum of squares on the legs.",
          keywords: ["pythagorean", "hypotenuse"],
          components: [],
        },
        ...v2Nodes,
      ],
      edges: [
        { from: "axioms-postulates", to: "triangle-congruence" },
        { from: "triangle-congruence", to: "pythagorean-theorem" },
        ...v2Edges,
      ],
      tracks: [
        {
          id: "core-proofs",
          name: "Classical Proofs Track",
          emoji: "📐",
          description: "From axioms to the Pythagorean theorem.",
          targets: ["pythagorean-theorem"],
        },
      ],
    },

    seeds: includeSeeds
      ? {
          starterDeck: {
            name: "Euclidean Geometry Core",
            description: "Essential axioms and theorems.",
            cards: [
              {
                key: "eg-card-postulate-5",
                front:
                  "What is **Playfair's form** of Euclid's Fifth Postulate?",
                back: "Through a point not on a given line, there is **at most one** line parallel to the given line.",
                nodeId: "axioms-postulates",
                pillarId: "foundations",
                topicId: "parallel-postulate",
                sectionId: "core-postulates",
              },
              {
                key: "eg-card-pythagoras",
                front:
                  "State the **Pythagorean identity** for legs $a, b$ and hypotenuse $c$.",
                back: "In any planar right triangle, $a^2 + b^2 = c^2$.",
                nodeId: "pythagorean-theorem",
                pillarId: "triangles-circles",
                topicId: "right-triangles",
                sectionId: "theorems",
                prerequisiteKey: "eg-card-postulate-5",
              },
              ...v2Cards,
            ],
          },
          drills: [
            {
              key: "eg-drill-interior-sum",
              nodeId: "axioms-postulates",
              difficulty: 3,
              prompt:
                "Prove using Euclid's parallel postulate that the interior angles of any planar triangle ABC sum to 180 degrees.",
              hints: [
                "Construct an auxiliary line through vertex A parallel to base BC.",
                "Identify alternate interior angles formed by transversals AB and AC.",
                "Sum the three adjacent angles along the straight line at vertex A.",
              ],
              workedSolution:
                "Draw line DE through A parallel to BC. By alternate interior angles, ∠DAB = ∠ABC and ∠EAC = ∠ACB. Since D-A-E is a straight angle (180°), ∠ABC + ∠BAC + ∠ACB = 180°.",
              rubricPoints: [
                "Constructs auxiliary parallel line through a vertex",
                "Applies alternate interior angles theorem",
                "Uses straight-line angle sum of 180 degrees",
              ],
            },
          ],
          baselineGuideNotes: [],
        }
      : {
          drills: [],
          baselineGuideNotes: [],
        },

    bibliography: [
      {
        title: "Euclid's Elements, Book I",
        note: "Propositions I.1–I.48",
      },
    ],
  });
}
