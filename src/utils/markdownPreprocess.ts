/**
 * Splits Markdown into untouched code segments (fenced ``` / ~~~ blocks, including
 * unclosed trailing streaming fences, plus inline backtick spans) and prose segments,
 * normalizing LaTeX delimiters and escaping standalone prose currency in prose only.
 */

// Matches:
// 1. Backtick fenced code blocks (3+ backticks, closed or unclosed trailing stream)
// 2. Tilde fenced code blocks (3+ tildes, closed or unclosed trailing stream)
// 3. Inline code spans (`+ ... `+ on a single line)
const CODE_SEGMENT_RE =
  /(^|\n)([ \t]{0,3})(`{3,})([^\n`]*)(?:\n[\s\S]*?(?:\n[ \t]{0,3}\3[ \t]*(?=\n|$)|$)|$)|(^|\n)([ \t]{0,3})(~{3,})([^\n]*)(?:\n[\s\S]*?(?:\n[ \t]{0,3}\7[ \t]*(?=\n|$)|$)|$)|(`+)(?!`)([^\n]+?)\9(?!`)/g;

const DISPLAY_LATEX_RE = /(?<!\\)\\\[([\s\S]*?)\\\]/g;
const INLINE_LATEX_RE = /(?<!\\)\\\(([^\n]+?)\\\)/g;
const DISPLAY_DOLLAR_BLOCK_RE = /\$\$[\s\S]*?\$\$/g;

// Matches standalone prose currency `$` (e.g. $150/mo, $400/yr, $0.02/GB, $10k, $5M,
// $50 - $100, $1,200) while leaving digit-leading math ($2^{32}$, $10^6$, $10^{-9}$,
// $2n + 1$, $2k + 1$, $0 \le p \le 1$) untouched.
const PROSE_CURRENCY_DOLLAR_RE =
  /(?<!\\|\$)\$(?=\d(?:\d|,\d{3})*(?:\.\d+)?(?:\/(?:mo(?:nth)?|yr|year|wk|week|day|hr|hour|min|sec|s|req(?:uest)?s?|GB|TB|MB|KB|GiB|TiB|MiB|user|seat|node|instance|call|token|k|M)\b|[kKmMbBtT]\b(?=\/|[,.;:!?)}\]]|\s+(?:per|to|and|or|vs\.?|USD|EUR|GBP|[a-z]{2,})\b|\s*[-–—]\s*\$|\s*\|\s*(?:\$|\r?\n|$)|[ \t]*(?:\r?\n|$))|\s+(?:per|to|and|or|vs\.?|USD|EUR|GBP|[a-z]{2,})\b|\s*[-–—]\s*\$|,(?=\s*(?:\$|[A-Za-z]|\r?\n|$))|\.(?=\s|$|[);\]])|[);!?]|\s*\|\s*(?:\$|\r?\n|$)|[ \t]*(?:\r?\n|$)))/g;

function preprocessProseSegment(segment: string): string {
  // 1. Convert display LaTeX \[ ... \] -> \n$$\n...\n$$\n
  let out = segment.replace(DISPLAY_LATEX_RE, (_m, inner: string) => `\n$$\n${inner.trim()}\n$$\n`);

  // 2. Convert inline LaTeX \( ... \) -> $...$ (trimmed so remark-math parses cleanly)
  out = out.replace(INLINE_LATEX_RE, (_m, inner: string) => `$${inner.trim()}$`);

  // 3. Protect $$...$$ display math blocks, then escape standalone prose currency `$`
  let result = "";
  let lastIdx = 0;
  for (const match of out.matchAll(DISPLAY_DOLLAR_BLOCK_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIdx) {
      result += out.slice(lastIdx, idx).replace(PROSE_CURRENCY_DOLLAR_RE, "\\$");
    }
    result += match[0];
    lastIdx = idx + match[0].length;
  }
  if (lastIdx < out.length) {
    result += out.slice(lastIdx).replace(PROSE_CURRENCY_DOLLAR_RE, "\\$");
  }
  return result;
}

export function preprocessMarkdown(raw: string): string {
  if (!raw) return "";

  let result = "";
  let lastIndex = 0;

  for (const match of raw.matchAll(CODE_SEGMENT_RE)) {
    const matchIndex = match.index ?? 0;
    // Preserve leading newline in prose if fence matched `(\n)` prefix
    const leadingNewline = match[1] || match[5] || "";
    const codeStart = matchIndex + leadingNewline.length;

    if (codeStart > lastIndex) {
      result += preprocessProseSegment(raw.slice(lastIndex, codeStart));
    }
    result += raw.slice(codeStart, matchIndex + match[0].length);
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < raw.length) {
    result += preprocessProseSegment(raw.slice(lastIndex));
  }

  return result;
}
