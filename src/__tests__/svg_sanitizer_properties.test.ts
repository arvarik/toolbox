// Seeded, bounded property tests for the SVG sanitizer (AI output and shared Kits are untrusted).
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "../utils/sanitizeSvg";

const RUNS = { seed: 20261109, numRuns: 200 };

const ALLOWED_TAGS = new Set(["svg", "g", "defs", "symbol", "marker", "clipPath", "mask", "linearGradient", "radialGradient", "stop", "pattern", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "use"]);
const TAGS = [...ALLOWED_TAGS, "script", "foreignObject", "image", "a", "style", "set", "animate", "iframe", "feImage", "SCRIPT", "x:script"];
const ATTRS = ["id", "d", "x", "width", "height", "fill", "stroke", "style", "transform", "viewBox", "href", "xlink:href", "onload", "OnClick", "onmouseover", "clip-path", "marker-end", "mask", "stroke-width", "font-family", "class", "src", "begin", "attributeName", "values"];
const VALUES = ["javascript:alert(1)", " JaVaScRiPt:x", "data:text/html,x", "url(#a)", "url(http://evil.test/x)", "url( 'javascript:x' )", "#a", "#b", "http://evil.test/", "red", "0 0 10 10", "expression(alert(1))", "fill:url(http://evil.test)", "fill:red;stroke:blue", "@import 'x'", "\\75rl(x)", "x;onload=alert(1)", "&#106;avascript:x", "&lt;script&gt;", "10", "a", "b"];

const escapeAttr = (v: string) => v.replace(/&(?!#?\w+;)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const { node } = fc.letrec<{ node: string }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constantFrom("hello", "<!-- c -->", "<![CDATA[<script>alert(1)</script>]]>", "&amp;", "<?pi x?>"),
    // Reference fragments, so <use>, href cycles, and url(#id) paths run often.
    fc.constantFrom('<path id="a" d="M0 0L9 9"/>', '<g id="b"><use href="#a"/></g>', '<use href="#a"/>', '<use xlink:href="#b"/>', '<linearGradient id="g" href="#g"/>', '<rect fill="url(#a)" clip-path="url(#b)"/>'),
    fc
      .record({
        tag: fc.constantFrom(...TAGS),
        attrs: fc.array(fc.tuple(fc.constantFrom(...ATTRS), fc.oneof(fc.constantFrom(...VALUES), fc.string({ maxLength: 8 }))), { maxLength: 4 }),
        children: fc.array(tie("node"), { maxLength: 3 }),
      })
      .map(({ tag, attrs, children }) => {
        const unique = [...new Map(attrs).entries()];
        const attrText = unique.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
        return `<${tag}${attrText}>${children.join("")}</${tag}>`;
      }),
  ),
}));

const svgDocument = fc
  .tuple(
    fc.constantFrom("", '<?xml version="1.0"?>', "<!-- lead -->"),
    fc.array(node, { maxLength: 4 }),
    fc.boolean(),
    fc.nat({ max: 6 }),
  )
  .map(([prolog, children, xlink, cut]) => {
    const ns = `xmlns="http://www.w3.org/2000/svg"${xlink ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ""}`;
    const doc = `${prolog}<svg ${ns} width="40" height="20">${children.join("")}</svg>`;
    // Sometimes truncate, like a stream that is still arriving.
    return cut === 0 ? doc.slice(0, Math.floor(doc.length / 2)) : doc;
  });

// Tag, sorted attributes, and children: attribute order is not meaningful.
function canonical(node: Node): string {
  if (node.nodeType !== 1) return JSON.stringify(node.textContent);
  const el = node as Element;
  const attrs = [...el.attributes].map((a) => `${a.name}=${a.value}`).sort();
  return `${el.nodeName}[${attrs.join(",")}](${[...el.childNodes].map(canonical).join(",")})`;
}

function assertSafeMarkup(markup: string): void {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  for (const el of [doc.documentElement, ...doc.documentElement.querySelectorAll("*")]) {
    expect(ALLOWED_TAGS.has(el.nodeName)).toBe(true);
    for (const attr of el.attributes) {
      expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
      expect(attr.value).not.toMatch(/javascript:|vbscript:|data:|expression|@import/i);
      if (attr.name === "href" || attr.name.endsWith(":href")) {
        expect(attr.value).toMatch(/^#p-[A-Za-z0-9_.-]+$/);
      }
      for (const ref of attr.value.matchAll(/url\(([^)]*)\)/gi)) {
        expect(ref[1]).toMatch(/^#p-[A-Za-z0-9_.-]+$/);
      }
    }
  }
}

describe("Property tests for the SVG sanitizer (fast-check)", () => {
  it("never throws; accepted output has only allowlisted tags, no event handlers, and only local references; a second pass changes nothing but the id prefix", () => {
    fc.assert(
      fc.property(svgDocument, (input) => {
        const first = sanitizeSvg(input, "p");
        expect(["ok", "incomplete", "error"]).toContain(first.status);
        if (first.status !== "ok") return;

        const markup = renderToStaticMarkup(first.element);
        assertSafeMarkup(markup);

        const second = sanitizeSvg(markup, "q");
        expect(second.status).toBe("ok");
        if (second.status !== "ok") return;
        const again = renderToStaticMarkup(second.element).replace(
          /(id="|href="#|url\(#)q-/g,
          "$1",
        );
        const parse = (m: string) =>
          new DOMParser().parseFromString(m, "image/svg+xml").documentElement;
        expect(canonical(parse(again))).toBe(canonical(parse(markup)));
      }),
      RUNS,
    );
  });

  it("returns quickly on comment-bomb and whitespace-bomb input (CodeQL js/redos)", () => {
    const started = performance.now();
    // Old prolog regex: exponential in the number of "--><!--" repeats (24 repeats took 147 ms, each +1 doubles it).
    expect(sanitizeSvg(`<!--${"--><!--".repeat(5_000)} xlink:href`, "p").status).not.toBe("ok");
    // Old /\s*!important\s*$/ style regex: O(n^2) (90,000 spaces took 2.8 s).
    const wide = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" style="fill:${" ".repeat(90_000)}red !important"/>`,
      "p",
    );
    expect(wide.status).toBe("ok");
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
