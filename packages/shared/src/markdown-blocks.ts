/**
 * Markdown → blocks and inline pieces: parsing only, no DOM; each view decides its own sizes and colors.
 *
 * Deliberately not CommonMark: a chat reply grows token by token and is parsed again each time, so the rules are small.
 * Half-written syntax (an open ``` fence, a lone `**`) reads as not finished yet: plain text for now, never an error.
 */

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  /** `start`: an ordered list's first number, when not 1 (items split by blank lines would all read "1."). */
  | { kind: 'list'; ordered: boolean; lines: string[]; start?: number }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'hr' };

/** What ends a paragraph: the line starts a block of another kind. */
const BLOCK_START = /^(#{1,6}\s|```|[-*]\s|\d+\.\s|\||>)/;

/** A block and the line it starts on (incremental parsing rescans from there). */
export interface ScannedBlock {
  block: MarkdownBlock;
  startLine: number;
}

function headingSlugBase(text: string): string {
  return text.trim().toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

/**
 * Scans from line `from` to the end (starting midway keeps unchanged blocks as the same objects; see rescanMarkdown).
 * `priorHeadings` are the kept headings' texts, so heading ids stay unique across the whole text.
 */
export function scanMarkdownBlocks(
  lines: string[],
  from = 0,
  priorHeadings: readonly string[] = [],
): ScannedBlock[] {
  const blocks: ScannedBlock[] = [];
  const slugCount = new Map<string, number>();
  for (const heading of priorHeadings) {
    const base = headingSlugBase(heading);
    slugCount.set(base, (slugCount.get(base) ?? 0) + 1);
  }
  let start = from;
  const push = (block: MarkdownBlock) => { blocks.push({ block, startLine: start }); };
  const pushHeading = (level: number, raw: string) => {
    const clean = raw.trim();
    const base = headingSlugBase(clean);
    const n = slugCount.get(base) ?? 0;
    slugCount.set(base, n + 1);
    push({ kind: 'heading', level, text: clean, id: n ? `${base}-${n + 1}` : base });
  };
  let i = from;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();
    if (!trimmed) { i += 1; continue; }
    // blank lines belong to no block: a block starts on this line
    start = i;
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const code: string[] = [];
      i += 1;
      // an unclosed fence runs to the end: normal while streaming
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      push({ kind: 'code', language, text: code.join('\n') });
      continue;
    }
    if (/^---+$/.test(trimmed)) { push({ kind: 'hr' }); i += 1; continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) { pushHeading(heading[1]!.length, heading[2]!); i += 1; continue; }
    if (trimmed.startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const ct = (lines[i] ?? '').trim();
        if (!ct.startsWith('>')) break;
        // one level only: a nested `>` stays in the text
        quoted.push(ct.replace(/^>\s?/, ''));
        i += 1;
      }
      push({ kind: 'quote', text: quoted.join('\n').trim() });
      continue;
    }
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length) {
      const sep = (lines[i + 1] ?? '').trim();
      if (/^\|[\s:-]+\|/.test(sep)) {
        const rows: string[][] = [];
        while (i < lines.length) {
          const row = (lines[i] ?? '').trim();
          if (!row.startsWith('|') || !row.endsWith('|')) break;
          if (/^\|[\s:-]+\|/.test(row)) { i += 1; continue; }
          rows.push(row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
          i += 1;
        }
        push({ kind: 'table', rows });
        continue;
      }
    }
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const ordered = /^\d+\.\s/.test(trimmed);
      const start = ordered ? Number(/^(\d+)\./.exec(trimmed)![1]) : 1;
      const acc: string[] = [];
      while (i < lines.length) {
        const ct = (lines[i] ?? '').trim();
        if (ordered ? /^\d+\.\s/.test(ct) : /^[-*]\s/.test(ct)) {
          acc.push(ct.replace(ordered ? /^\d+\.\s/ : /^[-*]\s/, ''));
          i += 1;
        } else break;
      }
      push({ kind: 'list', ordered, lines: acc, ...(ordered && start !== 1 ? { start } : {}) });
      continue;
    }
    const para = [trimmed];
    i += 1;
    while (i < lines.length) {
      const ct = (lines[i] ?? '').trim();
      if (!ct || BLOCK_START.test(ct)) break;
      para.push(ct);
      i += 1;
    }
    // newlines inside a paragraph are kept: whether they are spaces or breaks is the view's choice
    push({ kind: 'paragraph', text: para.join('\n') });
  }
  return blocks;
}

/** A scan and the text it was made from (the next scan checks whether it can continue). */
export interface MarkdownScan {
  text: string;
  blocks: ScannedBlock[];
}

/**
 * The first block that must be rescanned: the ones before it cannot change, whatever is appended.
 *
 * Only a boundary at a blank line is stable (a list can still grow when its next line becomes `- item`); headings and
 * rules are one line, so the boundary after them is stable too. With no stable boundary, everything is rescanned.
 */
function frozenBefore(blocks: readonly ScannedBlock[], lines: readonly string[]): number {
  for (let k = blocks.length - 1; k > 0; k -= 1) {
    const kind = blocks[k - 1]!.block.kind;
    if (kind === 'heading' || kind === 'hr') return k;
    const start = blocks[k]!.startLine;
    if (start > 0 && !(lines[start - 1] ?? '').trim()) return k;
  }
  return 0;
}

/**
 * Continues the previous scan: only the part that may still change is rescanned (see frozenBefore); earlier blocks keep
 * their identity, so memoized views skip them. Text that does not extend the previous one is scanned whole.
 */
export function rescanMarkdown(prev: MarkdownScan | null, text: string): MarkdownScan {
  if (prev && prev.text === text) return prev;
  const lines = text.split('\n');
  if (!prev || prev.blocks.length === 0 || !text.startsWith(prev.text)) {
    return { text, blocks: scanMarkdownBlocks(lines) };
  }
  const from = frozenBefore(prev.blocks, lines);
  if (from === 0) return { text, blocks: scanMarkdownBlocks(lines) };
  const kept = prev.blocks.slice(0, from);
  const priorHeadings = kept
    .map((entry) => (entry.block.kind === 'heading' ? entry.block.text : null))
    .filter((heading): heading is string => heading !== null);
  const rest = scanMarkdownBlocks(lines, prev.blocks[from]!.startLine, priorHeadings);
  return { text, blocks: kept.concat(rest) };
}

export type MarkdownInline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; text: string; href: string };

/**
 * Inline tokens. Code comes first (`` `**x**` `` is code, not emphasis). Italics take a single `*` only, never `_`,
 * which would split identifiers like `file_path`.
 */
const INLINE_TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]\n]*)\]\(([^()\s]*)\)/g;

/** A line → inline pieces. Anything not recognized stays plain text, so half-written syntax spoils nothing. */
export function parseInlineMarkdown(text: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  const pushText = (chunk: string) => {
    if (!chunk) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += chunk;
    else out.push({ kind: 'text', text: chunk });
  };
  // a global regex keeps its position: start from the beginning each time
  INLINE_TOKEN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TOKEN.exec(text))) {
    const token = matchToInline(match, text);
    if (!token) {
      // not a fit (half syntax, an unsafe link): rescan from the next character; these characters stay text
      INLINE_TOKEN.lastIndex = match.index + 1;
      continue;
    }
    pushText(text.slice(cursor, match.index));
    out.push(token);
    cursor = match.index + match[0]!.length;
  }
  pushText(text.slice(cursor));
  return out;
}

function matchToInline(match: RegExpExecArray, text: string): MarkdownInline | null {
  // groups that did not match are undefined
  const [, code, strong, em, linkText, href]: (string | undefined)[] = match;
  if (code !== undefined) return { kind: 'code', text: code };
  if (strong !== undefined) return { kind: 'strong', text: strong };
  if (em !== undefined) {
    // next to another `*` it is not italics (inside `**bold**`, or a glob like `**/*.tsx`)
    if (text[match.index - 1] === '*' || text[match.index + match[0]!.length] === '*') return null;
    if (/\s$/.test(em)) return null;
    return { kind: 'em', text: em };
  }
  if (linkText !== undefined && href !== undefined) {
    const safe = safeMarkdownHref(href);
    if (!safe || !linkText.trim()) return null;
    return { kind: 'link', text: linkText, href: safe };
  }
  return null;
}

/**
 * Allowed link targets: http(s) and relative paths only; anything else (`javascript:`, `data:` …) is null and shows as
 * text. The text is model output, so untrusted. Control characters and spaces are removed before the scheme is checked,
 * as a browser would, so `java\nscript:` does not slip through.
 */
export function safeMarkdownHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  const probe = href.replace(/[\u0000-\u0020\u00a0\u2028\u2029]/g, '').toLowerCase();
  if (!probe) return null;
  // `//host` leaves the site: not a relative path
  if (probe.startsWith('//')) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(probe)?.[1];
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;
  return href;
}
