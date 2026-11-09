import React from "react";

export type SanitizeSvgResult =
  | { status: "ok"; element: React.ReactElement }
  | { status: "incomplete" }
  | { status: "error"; reason: string };

const MAX_SVG_BYTES = 100_000;
const MAX_SVG_ELEMENTS = 1_000;
const MAX_SVG_DEPTH = 64;
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

// Exact 22 case-sensitive allowlisted static SVG primitives
const ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "marker",
  "clipPath",
  "mask",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "use",
]);

const TEXT_CONTAINER_TAGS = new Set(["text", "tspan", "title"]);
const HREF_ALLOWED_TAGS = new Set(["use", "linearGradient", "radialGradient", "pattern"]);
const URL_ONLY_ATTRS = new Set(["marker-start", "marker-mid", "marker-end", "clip-path", "mask"]);
const PAINT_URL_OR_COLOR_ATTRS = new Set(["fill", "stroke"]);

const ATTR_TO_REACT_PROP: Record<string, string> = {
  viewBox: "viewBox",
  preserveAspectRatio: "preserveAspectRatio",
  transform: "transform",
  x: "x",
  y: "y",
  x1: "x1",
  y1: "y1",
  x2: "x2",
  y2: "y2",
  cx: "cx",
  cy: "cy",
  r: "r",
  rx: "rx",
  ry: "ry",
  fx: "fx",
  fy: "fy",
  fr: "fr",
  dx: "dx",
  dy: "dy",
  width: "width",
  height: "height",
  d: "d",
  points: "points",
  pathLength: "pathLength",
  rotate: "rotate",
  offset: "offset",
  "stop-color": "stopColor",
  stopColor: "stopColor",
  "stop-opacity": "stopOpacity",
  stopOpacity: "stopOpacity",
  gradientUnits: "gradientUnits",
  gradientTransform: "gradientTransform",
  spreadMethod: "spreadMethod",
  patternUnits: "patternUnits",
  patternContentUnits: "patternContentUnits",
  patternTransform: "patternTransform",
  clipPathUnits: "clipPathUnits",
  maskUnits: "maskUnits",
  maskContentUnits: "maskContentUnits",
  markerUnits: "markerUnits",
  markerWidth: "markerWidth",
  markerHeight: "markerHeight",
  refX: "refX",
  refY: "refY",
  orient: "orient",
  fill: "fill",
  stroke: "stroke",
  opacity: "opacity",
  color: "color",
  "fill-opacity": "fillOpacity",
  fillOpacity: "fillOpacity",
  "fill-rule": "fillRule",
  fillRule: "fillRule",
  "clip-rule": "clipRule",
  clipRule: "clipRule",
  "clip-path": "clipPath",
  clipPath: "clipPath",
  mask: "mask",
  "stroke-width": "strokeWidth",
  strokeWidth: "strokeWidth",
  "stroke-dasharray": "strokeDasharray",
  strokeDasharray: "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  strokeDashoffset: "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  strokeLinecap: "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  strokeLinejoin: "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  strokeMiterlimit: "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  strokeOpacity: "strokeOpacity",
  "vector-effect": "vectorEffect",
  vectorEffect: "vectorEffect",
  "paint-order": "paintOrder",
  paintOrder: "paintOrder",
  "marker-start": "markerStart",
  markerStart: "markerStart",
  "marker-mid": "markerMid",
  markerMid: "markerMid",
  "marker-end": "markerEnd",
  markerEnd: "markerEnd",
  "font-family": "fontFamily",
  fontFamily: "fontFamily",
  "font-size": "fontSize",
  fontSize: "fontSize",
  "font-weight": "fontWeight",
  fontWeight: "fontWeight",
  "font-style": "fontStyle",
  fontStyle: "fontStyle",
  "text-anchor": "textAnchor",
  textAnchor: "textAnchor",
  "dominant-baseline": "dominantBaseline",
  dominantBaseline: "dominantBaseline",
  "alignment-baseline": "alignmentBaseline",
  "baseline-shift": "baselineShift",
  "letter-spacing": "letterSpacing",
  "word-spacing": "wordSpacing",
  textLength: "textLength",
  lengthAdjust: "lengthAdjust",
  role: "role",
  "aria-label": "aria-label",
};

const STYLE_PROP_TO_REACT: Record<string, string> = {
  fill: "fill",
  stroke: "stroke",
  "stroke-width": "strokeWidth",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  opacity: "opacity",
  "fill-opacity": "fillOpacity",
  "stroke-opacity": "strokeOpacity",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "font-family": "fontFamily",
  "text-anchor": "textAnchor",
  "dominant-baseline": "dominantBaseline",
};

const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;
const LOCAL_HREF_RE = /^#([A-Za-z0-9_.-]+)$/;
const LOCAL_URL_RE = /^url\(\s*['"]?#([A-Za-z0-9_.-]+)['"]?\s*\)$/i;
const VIEWBOX_RE = /^\s*-?\d+(?:\.\d+)?(?:[\s,]+-?\d+(?:\.\d+)?){3}\s*$/;
const NUMERIC_DIM_RE = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i;
const FORBIDDEN_STYLE_VAL_RE = /url\s*\(|@|\\|:|;|\/\*|\*\/|expression/i;
const FORBIDDEN_ATTR_VAL_RE =
  /url\s*\(|javascript:|vbscript:|data:|expression|@|\\|;|\/\*|\*\//i;

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

function isAllowedElement(el: Element): boolean {
  return (
    (el.namespaceURI === null || el.namespaceURI === SVG_NS) &&
    ALLOWED_TAGS.has(el.nodeName)
  );
}

function looksLikeStreamingSvg(trimmed: string): boolean {
  if (!trimmed) return true;
  if (/<\/svg>\s*$/i.test(trimmed)) return false;
  const strippedLeading = trimmed.replace(/^(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)*/i, "");
  if (!strippedLeading) return true;
  if (/^<(?:s(?:v(?:g(?:\s|\/|$)[\s\S]*)?)?)?$/i.test(strippedLeading)) {
    // Exclude self-closed complete root <svg ... />
    return !/^<svg\b[^>]*\/>\s*$/i.test(strippedLeading);
  }
  return /^<\?|^<!--/i.test(strippedLeading);
}

function parseSafeStyle(rawStyle: string): Record<string, string> {
  if (!rawStyle || rawStyle.includes("/*") || rawStyle.includes("*/")) {
    return {};
  }
  const safe: Record<string, string> = {};
  for (const decl of rawStyle.split(";")) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx <= 0) continue;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    const reactKey = STYLE_PROP_TO_REACT[prop];
    if (!reactKey) continue;
    const val = decl
      .slice(colonIdx + 1)
      .replace(/\s*!important\s*$/i, "")
      .trim();
    if (!val || hasControlChar(val) || FORBIDDEN_STYLE_VAL_RE.test(val)) continue;
    safe[reactKey] = val;
  }
  return safe;
}

function subtreeHasUseAndCount(el: Element, depth = 0): { hasUse: boolean; count: number } {
  if (depth > MAX_SVG_DEPTH) return { hasUse: true, count: MAX_SVG_ELEMENTS + 1 };
  let hasUse = el.nodeName === "use" || el.localName === "use";
  let count = 1;
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    const sub = subtreeHasUseAndCount(child, depth + 1);
    if (sub.hasUse) hasUse = true;
    count += sub.count;
  }
  return { hasUse, count };
}

function isAncestorOrSelf(candidateAncestor: Element, node: Element): boolean {
  let cur: Element | null = node;
  while (cur) {
    if (cur === candidateAncestor) return true;
    cur = cur.parentElement;
  }
  return false;
}

function hasHrefCycle(startEl: Element, idMap: Map<string, Element>): boolean {
  const seen = new Set<Element>([startEl]);
  let cur: Element | undefined = startEl;
  while (cur) {
    const rawHref =
      cur.getAttribute("href") ??
      cur.getAttribute("xlink:href") ??
      cur.getAttributeNS(XLINK_NS, "href");
    const match = rawHref ? LOCAL_HREF_RE.exec(rawHref.trim()) : null;
    if (!match) return false;
    const next = idMap.get(match[1]);
    if (!next) return false;
    if (seen.has(next)) return true;
    seen.add(next);
    cur = next;
  }
  return false;
}

export function sanitizeSvg(raw: string, instancePrefix: string): SanitizeSvgResult {
  if (typeof raw !== "string") {
    return { status: "error", reason: "Invalid SVG input." };
  }
  if (raw.length > MAX_SVG_BYTES || new TextEncoder().encode(raw).byteLength > MAX_SVG_BYTES) {
    return { status: "error", reason: "SVG exceeds maximum size (100 KB)." };
  }
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(raw)) {
    return { status: "error", reason: "XML DTD and ENTITY declarations are not allowed." };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { status: "incomplete" };
  }

  const xmlInput =
    /\bxlink:[A-Za-z]/i.test(trimmed) && !/\bxmlns:xlink\s*=/i.test(trimmed)
      ? trimmed.replace(
          /^(\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)*<svg\b)/i,
          `$1 xmlns:xlink="${XLINK_NS}"`,
        )
      : trimmed;

  const doc = new DOMParser().parseFromString(xmlInput, "image/svg+xml");
  const root = doc.documentElement;
  const hasParserError =
    !root ||
    root.nodeName.toLowerCase() === "parsererror" ||
    doc.querySelector("parsererror") !== null;

  if (hasParserError || root.nodeName !== "svg" || !isAllowedElement(root)) {
    if (looksLikeStreamingSvg(trimmed)) {
      return { status: "incomplete" };
    }
    return {
      status: "error",
      reason: root && root.nodeName !== "svg" && !hasParserError
        ? "Root element must be <svg>."
        : "Malformed SVG XML.",
    };
  }

  const safePrefix = instancePrefix.replace(/[^A-Za-z0-9_-]/g, "") || "svg";
  const idMap = new Map<string, Element>();
  let totalElements = 0;
  let exceededDepth = false;

  const indexTree = (el: Element, depth: number): void => {
    if (depth > MAX_SVG_DEPTH) {
      exceededDepth = true;
      return;
    }
    totalElements += 1;
    if (totalElements > MAX_SVG_ELEMENTS) return;
    if (!isAllowedElement(el)) return;

    const rawId = el.getAttribute("id")?.trim();
    if (rawId && SAFE_ID_RE.test(rawId) && !idMap.has(rawId)) {
      idMap.set(rawId, el);
    }
    for (let i = 0; i < el.children.length; i++) {
      indexTree(el.children[i], depth + 1);
      if (totalElements > MAX_SVG_ELEMENTS || exceededDepth) return;
    }
  };

  indexTree(root, 0);
  if (exceededDepth) {
    return { status: "error", reason: "SVG exceeds maximum nesting depth." };
  }
  if (totalElements > MAX_SVG_ELEMENTS) {
    return { status: "error", reason: "SVG exceeds maximum element count (1,000)." };
  }

  let expandedUseBudget = totalElements;
  let bombError: string | null = null;

  const cloneElement = (el: Element, isRoot: boolean, key?: number): React.ReactElement | null => {
    if (bombError || !isAllowedElement(el)) return null;
    const tag = el.nodeName;
    const safeProps: Record<string, unknown> = {};
    if (key !== undefined) {
      safeProps.key = key;
    }

    // Validate <use> and local #fragment href before cloning attributes
    if (HREF_ALLOWED_TAGS.has(tag)) {
      const rawHref =
        el.getAttribute("href") ??
        el.getAttribute("xlink:href") ??
        el.getAttributeNS(XLINK_NS, "href");
      if (rawHref !== null) {
        const hrefMatch = LOCAL_HREF_RE.exec(rawHref.trim());
        if (!hrefMatch) {
          if (tag === "use") return null;
        } else {
          const targetId = hrefMatch[1];
          const targetEl = idMap.get(targetId);
          if (!targetEl) {
            if (tag === "use") return null;
          } else if (tag === "use") {
            if (isAncestorOrSelf(targetEl, el)) {
              bombError = "Cyclic <use> reference is not allowed.";
              return null;
            }
            const targetStats = subtreeHasUseAndCount(targetEl);
            if (targetStats.hasUse) {
              bombError = "Nested <use> references are not allowed.";
              return null;
            }
            expandedUseBudget += targetStats.count;
            if (expandedUseBudget > MAX_SVG_ELEMENTS) {
              bombError = "SVG <use> expansion exceeds element budget.";
              return null;
            }
            safeProps.href = `#${safePrefix}-${targetId}`;
          } else if (!hasHrefCycle(el, idMap)) {
            safeProps.href = `#${safePrefix}-${targetId}`;
          }
        }
      } else if (tag === "use") {
        return null;
      }
    }

    let safeStyle: Record<string, string> = {};

    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      const name = attr.name;
      const rawVal = attr.value;
      const val = rawVal.trim();

      if (
        name === "xmlns" ||
        name === "href" ||
        name === "xlink:href" ||
        name.startsWith("xmlns:") ||
        name.toLowerCase().startsWith("on")
      ) {
        continue;
      }

      if (name === "id") {
        if (SAFE_ID_RE.test(val)) {
          safeProps.id = `${safePrefix}-${val}`;
        }
        continue;
      }

      if (name === "style") {
        safeStyle = parseSafeStyle(rawVal);
        continue;
      }

      const kebabKey = name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      if (URL_ONLY_ATTRS.has(name) || URL_ONLY_ATTRS.has(kebabKey)) {
        const reactProp = ATTR_TO_REACT_PROP[name] ?? ATTR_TO_REACT_PROP[kebabKey];
        if (!reactProp) continue;
        if (val.toLowerCase() === "none") {
          safeProps[reactProp] = "none";
        } else {
          const urlMatch = LOCAL_URL_RE.exec(val);
          if (urlMatch) {
            safeProps[reactProp] = `url(#${safePrefix}-${urlMatch[1]})`;
          }
        }
        continue;
      }

      if (PAINT_URL_OR_COLOR_ATTRS.has(name)) {
        const reactProp = ATTR_TO_REACT_PROP[name];
        if (!reactProp) continue;
        if (/url\s*\(/i.test(val) || val.toLowerCase().includes("url(")) {
          const urlMatch = LOCAL_URL_RE.exec(val);
          if (urlMatch) {
            safeProps[reactProp] = `url(#${safePrefix}-${urlMatch[1]})`;
          }
          // Strip non-local url(...) completely
        } else if (!hasControlChar(val) && !FORBIDDEN_ATTR_VAL_RE.test(val)) {
          safeProps[reactProp] = val;
        }
        continue;
      }

      const reactProp = ATTR_TO_REACT_PROP[name];
      if (!reactProp) continue;
      if (hasControlChar(val) || FORBIDDEN_ATTR_VAL_RE.test(val)) continue;
      if (name === "viewBox" && !VIEWBOX_RE.test(val)) continue;

      safeProps[reactProp] = val;
    }

    if (isRoot) {
      safeProps.xmlns = SVG_NS;
      if (!safeProps.viewBox) {
        const wMatch = typeof safeProps.width === "string" ? NUMERIC_DIM_RE.exec(safeProps.width) : null;
        const hMatch = typeof safeProps.height === "string" ? NUMERIC_DIM_RE.exec(safeProps.height) : null;
        if (wMatch && hMatch) {
          const w = Number(wMatch[1]);
          const h = Number(hMatch[1]);
          if (w > 0 && h > 0) {
            safeProps.viewBox = `0 0 ${w} ${h}`;
          }
        }
      }
      safeProps.style = {
        ...safeStyle,
        maxWidth: "100%",
        height: "auto",
      };
    } else if (Object.keys(safeStyle).length > 0) {
      safeProps.style = safeStyle;
    }

    const children: React.ReactNode[] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === 1) {
        const cloned = cloneElement(child as Element, false, i);
        if (bombError) return null;
        if (cloned) children.push(cloned);
      } else if ((child.nodeType === 3 || child.nodeType === 4) && TEXT_CONTAINER_TAGS.has(tag)) {
        if (child.nodeValue) {
          children.push(child.nodeValue);
        }
      }
    }

    return React.createElement(tag, safeProps, ...children);
  };

  const element = cloneElement(root, true);
  if (bombError) {
    return { status: "error", reason: bombError };
  }
  if (!element) {
    return { status: "error", reason: "Unable to render SVG." };
  }
  return { status: "ok", element };
}
