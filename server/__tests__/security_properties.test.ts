// @vitest-environment node
// Seeded, bounded property tests for the parsers that read untrusted input.
// A failure prints the seed and the shrunk counterexample; rerun with that seed to debug.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  topologicalSort,
  verifyKitSkeleton,
} from "../../shared/kits/kitSkeleton.ts";
import { normalizeEndpointBaseUrl } from "../platform/ai/aiSettingsService.ts";
import {
  BadRequestError,
  canonicalizeZipPath,
  createZipArchive,
  extractZipArchive,
} from "../platform/archive/zip.ts";
import { safeReturnTo } from "../platform/auth/passkeyAndOidc.ts";
import { __resetHostGuard, isHostAllowed } from "../platform/net/hostGuard.ts";
import {
  assertPublicHttpUrl,
  isPrivateAddress,
  safeFetch,
} from "../platform/net/originAndFetch.ts";
import { makeKitSkeleton } from "./testHelpers.ts";

const RUNS = { seed: 20261109, numRuns: 200 };

describe("Property tests for untrusted-input parsers (fast-check)", () => {
  it("ZIP reader: random, truncated, and mutated archives fail only with BadRequestError; accepted output has safe paths and respects the byte cap", async () => {
    const valid = await createZipArchive([
      { name: "kit.json", data: Buffer.from('{"format":"toolbox-kit"}') },
      { name: "sources/notes.txt", data: Buffer.alloc(600, 0x61) },
    ]);
    const archive = fc.oneof(
      fc.uint8Array({ maxLength: 400 }).map((b) => Buffer.from(b)),
      fc.nat({ max: valid.length }).map((n) => valid.subarray(0, n)),
      fc
        .array(
          fc.tuple(fc.nat({ max: valid.length - 1 }), fc.nat({ max: 255 })),
          { minLength: 1, maxLength: 6 },
        )
        .map((flips) => {
          const b = Buffer.from(valid);
          for (const [i, v] of flips) b[i] = v;
          return b;
        }),
    );
    await fc.assert(
      fc.asyncProperty(archive, fc.integer({ min: 1, max: 2048 }), async (buf, cap) => {
        let out: Map<string, Buffer>;
        try {
          out = await extractZipArchive(buf, { maxTotalUncompressedBytes: cap });
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestError);
          return;
        }
        let total = 0;
        for (const [name, data] of out) {
          expect(canonicalizeZipPath(name)).toBe(name);
          total += data.byteLength;
        }
        expect(total).toBeLessThanOrEqual(cap);
      }),
      RUNS,
    );
  });

  it("ZIP reader: an entry name with traversal, an absolute path, a backslash, or NUL is never accepted", async () => {
    const segment = fc.constantFrom("..", ".", "", "a", "kit.json", "%2e%2e", "..\\x", "\0", "C:");
    const name = fc
      .tuple(fc.boolean(), fc.array(segment, { minLength: 1, maxLength: 4 }))
      .map(([lead, parts]) => (lead ? "/" : "") + parts.join("/"))
      .filter((n) => Buffer.byteLength(n) > 0);
    const isUnsafe = (n: string) =>
      n.includes("\0") ||
      n.includes("\\") ||
      n.startsWith("/") ||
      n.split("/").some((p) => p === "" || p === "." || p === "..");

    await fc.assert(
      fc.asyncProperty(name, async (evil) => {
        // Build a valid archive with a same-length placeholder name, then write the
        // raw name into both headers (createZipArchive itself refuses unsafe names).
        const raw = Buffer.from(evil, "utf8");
        const placeholder = Buffer.alloc(raw.length, "q");
        const buf = await createZipArchive([
          { name: placeholder.toString(), data: Buffer.from("x") },
        ]);
        for (let at = buf.indexOf(placeholder); at !== -1; at = buf.indexOf(placeholder, at + 1)) {
          raw.copy(buf, at);
        }
        const result = await extractZipArchive(buf).then(
          (m) => [...m.keys()],
          (err: unknown) => err,
        );
        if (isUnsafe(evil)) {
          expect(result).toBeInstanceOf(BadRequestError);
        } else if (Array.isArray(result)) {
          expect(result).toEqual([evil]);
        }
      }),
      RUNS,
    );
  });

  it("Kit JSON verifier: an accepted Kit is a valid DAG with resolved references, errors are never crashes, and __proto__ keys pollute nothing", () => {
    const id = fc.constantFrom("a", "b", "c", "d", "e", "f");
    // Valid references by construction; random edges add cycles and self-loops,
    // and `dangling` adds a reference to a pillar or node that does not exist.
    const kitInput = fc.record({
      pillars: fc.uniqueArray(id, { minLength: 1, maxLength: 3 }),
      topics: fc.uniqueArray(id, { minLength: 1, maxLength: 3 }),
      nodeIds: fc.uniqueArray(id, { minLength: 1, maxLength: 6 }),
      edges: fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 6 }),
      targets: fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
      dangling: fc.constantFrom("none", "none", "none", "pillar", "edge", "target"),
      noise: fc.jsonValue({ maxDepth: 2 }),
    });

    fc.assert(
      fc.property(kitInput, (k) => {
        const at = <T,>(list: readonly T[], i: number) => list[i % list.length];
        const skeleton = makeKitSkeleton((s) => {
          s.pillars = k.pillars.map((pid) => ({
            ...s.pillars[0],
            id: pid,
            topics: k.topics.map((tid) => ({ id: tid, name: tid })),
          }));
          s.graph.nodes = k.nodeIds.map((nid, i) => ({
            ...s.graph.nodes[0],
            id: nid,
            pillarId: k.dangling === "pillar" && i === 0 ? "zz" : at(k.pillars, i),
            topicId: i % 2 === 0 ? null : at(k.topics, i),
          }));
          s.graph.edges = k.edges.map(([f, t]) => ({ from: at(k.nodeIds, f), to: at(k.nodeIds, t) }));
          if (k.dangling === "edge") s.graph.edges.push({ from: k.nodeIds[0], to: "zz" });
          const targets: string[] = k.targets.map((t) => at(k.nodeIds, t));
          if (k.dangling === "target") targets.push("zz");
          s.graph.tracks = [{ ...s.graph.tracks[0], targets }];
        });
        // JSON.parse turns "__proto__" into an own key, as an uploaded file would.
        const text = JSON.stringify(skeleton).replace(
          '"identity":{',
          `"__proto__":{"polluted":true},"identity":{"__proto__":${JSON.stringify(k.noise)},`,
        );

        let kit: ReturnType<typeof verifyKitSkeleton>;
        try {
          kit = verifyKitSkeleton(JSON.parse(text));
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
          expect(err).not.toBeInstanceOf(TypeError);
          expect(err).not.toBeInstanceOf(RangeError);
          return;
        } finally {
          expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        }

        const nodeIds = kit.graph.nodes.map((n) => n.id);
        expect(new Set(nodeIds).size).toBe(nodeIds.length);
        const order = topologicalSort(kit.graph.nodes, kit.graph.edges);
        expect([...order].sort()).toEqual([...nodeIds].sort());
        const position = new Map(order.map((nid, i) => [nid, i]));
        for (const e of kit.graph.edges) {
          expect(position.get(e.from)!).toBeLessThan(position.get(e.to)!);
        }
        if (kit.graph.edges.length === 0) expect(order).toEqual(nodeIds);
        for (const n of kit.graph.nodes) {
          const pillar = kit.pillars.find((p) => p.id === n.pillarId);
          expect(pillar).toBeDefined();
          if (n.topicId !== null) {
            expect(pillar!.topics.some((t) => t.id === n.topicId)).toBe(true);
          }
        }
        for (const t of kit.graph.tracks) {
          for (const target of t.targets) expect(nodeIds).toContain(target);
        }
      }),
      RUNS,
    );
  });

  it("SSRF guard: every IP-literal spelling of a private or metadata address is refused before any connection", async () => {
    const v4 = (a: number, b: number, c: number, d: number) =>
      ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
    // [network, prefix length, refused even when private targets are allowed]
    const RANGES: Array<[number, number, boolean]> = [
      [v4(0, 0, 0, 0), 8, true],
      [v4(10, 0, 0, 0), 8, false],
      [v4(100, 64, 0, 0), 10, false],
      [v4(127, 0, 0, 0), 8, false],
      [v4(169, 254, 0, 0), 16, true],
      [v4(172, 16, 0, 0), 12, false],
      [v4(192, 168, 0, 0), 16, false],
      [v4(198, 18, 0, 0), 15, false],
      [v4(224, 0, 0, 0), 3, true],
    ];
    const target = fc
      .tuple(fc.constantFrom(...RANGES), fc.nat())
      .map(([[net, prefix, metadata], r]) => {
        const hostBits = prefix === 32 ? 0 : r % 2 ** (32 - prefix);
        return { ip: (net + hostBits) >>> 0, metadata };
      });
    const spellings = (ip: number): string[] => {
      const o = [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255];
      const dotted = o.join(".");
      const hi = (ip >>> 16).toString(16);
      const lo = (ip & 0xffff).toString(16);
      return [
        dotted,
        String(ip),
        `0x${ip.toString(16)}`,
        o.map((x) => `0${x.toString(8)}`).join("."),
        `${o[0]}.${(ip & 0xffffff) >>> 0}`,
        `[::ffff:${dotted}]`,
        `[::ffff:${hi}:${lo}]`,
        `[::ffff:0:${dotted}]`,
        `[64:ff9b::${dotted}]`,
        // IPv4-compatible form. ::0.0.0.1 is the IPv6 loopback ::1, so that one address stays dotted.
        ip === 1 ? dotted : `[::${dotted}]`,
        `[2002:${hi}:${lo}::]`,
      ];
    };

    await fc.assert(
      fc.asyncProperty(target, fc.integer({ min: 0, max: 10 }), async ({ ip, metadata }, k) => {
        const url = `http://${spellings(ip)[k]}/v1`;
        const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
        expect(isPrivateAddress(host)).toBe(true);
        await expect(assertPublicHttpUrl(url)).rejects.toThrow(/private address/);
        expect(() => normalizeEndpointBaseUrl(url, { allowPrivate: false })).toThrow();
        if (metadata) {
          expect(() => normalizeEndpointBaseUrl(url, { allowPrivate: true })).toThrow(/blocked/);
          await expect(
            safeFetch(url, { allowPrivate: true, timeoutMs: 50 }),
          ).rejects.toThrow(/blocked address/);
        }
      }),
      RUNS,
    );

    // Public IPv4 literals stay allowed (no over-blocking).
    const inRange = (ip: number) =>
      RANGES.some(([net, prefix]) => ip >>> (32 - prefix) === net >>> (32 - prefix));
    fc.assert(
      fc.property(fc.nat({ max: 0xffffffff }).filter((ip) => !inRange(ip)), (ip) => {
        const dotted = [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join(".");
        expect(isPrivateAddress(dotted)).toBe(false);
        expect(isPrivateAddress(`::ffff:${dotted}`)).toBe(false);
      }),
      RUNS,
    );
    // Teredo is refused, and a public 2001: address is not.
    expect(isPrivateAddress("2001:0:4136:e378:8000:63bf:3fff:fdd2")).toBe(true);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("Host guard: an attacker-controlled DNS name is never an allowed Host; IP literals are; no input throws", () => {
    __resetHostGuard();
    const attackerDomain = fc
      .domain()
      .filter((d) => !/\.(localhost|local)$/i.test(d) && d.includes("."));
    fc.assert(
      fc.property(attackerDomain, fc.integer({ min: 1, max: 65535 }), (d, port) => {
        for (const host of [d, d.toUpperCase(), `${d}:${port}`, `${d}.`, `[${d}]`]) {
          expect(isHostAllowed(host)).toBe(false);
        }
      }),
      RUNS,
    );
    fc.assert(
      fc.property(fc.ipV4(), fc.ipV6(), (ip4, ip6) => {
        expect(isHostAllowed(ip4)).toBe(true);
        expect(isHostAllowed(`[${ip6}]:3100`)).toBe(true);
      }),
      RUNS,
    );
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 64 }), (raw) => {
        expect(typeof isHostAllowed(raw)).toBe("boolean");
      }),
      RUNS,
    );
  });

  it("OIDC returnTo: an accepted value always resolves to the same origin (no open redirect)", () => {
    const tricky = fc.constantFrom("/", "\\", "//", ".", "@", ":", "%2f", "%5c", "\t", "\n", " ", "　", "a", "?", "#", "evil.test");
    const candidate = fc.oneof(
      fc.string({ unit: "binary", maxLength: 24 }),
      fc.string({ unit: tricky, maxLength: 8 }),
      fc.string({ unit: tricky, maxLength: 8 }).map((s) => `/${s}`),
      fc.webPath(),
      fc.webUrl(),
    );
    fc.assert(
      fc.property(candidate, (value) => {
        const accepted = safeReturnTo(value);
        if (accepted === null) return;
        expect(accepted).toBe(value);
        expect(new URL(accepted, "https://app.test").origin).toBe("https://app.test");
      }),
      RUNS,
    );
  });
});
