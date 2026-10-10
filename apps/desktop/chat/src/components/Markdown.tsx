'use client';

import * as React from 'react';
import {
  parseInlineMarkdown,
  rescanMarkdown,
  type MarkdownBlock,
  type MarkdownScan,
} from '@openfilm/shared/markdown';
import type { StudioRef } from '../app-bridge';
import { useT } from '@/i18n';
import { agentRefPill, parseAgentRefs } from '@/lib/agent-refs';
import { useClipSrc } from '@/lib/studio-film';
import { PromptPill, PromptPillRevealContext } from './prompt-editor';

/**
 * Markdown in the conversation.
 *
 * This is speech, not a document page: the size matches the text rows around it (14px / 1.65, as tool rows and
 * thoughts), blocks sit close together, headings differ only by weight and a touch of size, with no anchors or
 * line numbers.
 */
export function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  const blocks = useMarkdownBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className={`flex min-w-0 flex-col gap-2 text-[14px] leading-[1.65] ${muted ? 'text-[var(--chat-hint)]' : 'text-[var(--chat-text)]'}`}>
      {blocks.map((block, index) => <MarkdownRow key={index} block={block} />)}
    </div>
  );
}

/**
 * Incremental parsing, one cache per message.
 *
 * The text streams in token by token. Reparsing each frame isn't slow, but it makes new block objects, so every
 * memoized MarkdownRow re-renders: near the end of a long reply, each token re-renders dozens of blocks.
 * rescanMarkdown rescans only the part that can still change and keeps unchanged blocks as the same objects, so the
 * memo works.
 *
 * Writing the ref is caching, not state: the same text always parses the same, so an interrupted render can't
 * break it. Before continuing, the scan checks the old text is a prefix, and rescans everything if not.
 */
function useMarkdownBlocks(text: string): MarkdownBlock[] {
  const cache = React.useRef<MarkdownScan | null>(null);
  const rows = React.useRef<MarkdownBlock[]>([]);
  const next = rescanMarkdown(cache.current, text);
  if (next !== cache.current) {
    cache.current = next;
    rows.current = next.blocks.map((entry) => entry.block);
  }
  return rows.current;
}

const MarkdownRow = React.memo(function MarkdownRow({ block }: { block: MarkdownBlock }) {
  if (block.kind === 'heading') {
    // No room for an h1 in a conversation: a heading only leads a few lines, a little top space is enough.
    const cls = block.level <= 2
      ? 'pt-1 text-[1.07em] font-semibold text-[var(--chat-text)]'
      : 'pt-0.5 font-semibold text-[var(--chat-text)]';
    return <p className={cls}>{inline(block.text)}</p>;
  }
  if (block.kind === 'paragraph') {
    // In chat a single newline is a line break (not a space as in CommonMark): three lines the model wrote
    // separately must not run into one sentence.
    return <p className="whitespace-pre-wrap break-words">{inline(block.text)}</p>;
  }
  if (block.kind === 'quote') {
    return (
      <blockquote className="whitespace-pre-wrap break-words border-l-2 border-[var(--border)] pl-2.5 text-[var(--text-muted)]">
        {inline(block.text)}
      </blockquote>
    );
  }
  if (block.kind === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag
        {...(block.ordered && block.start != null ? { start: block.start } : {})}
        className={`flex flex-col gap-0.5 pl-[18px] marker:text-[var(--text-faint)] ${
          block.ordered ? 'list-decimal' : 'list-disc'
        }`}
      >
        {block.lines.map((line, index) => (
          <li key={index} className="break-words">{inline(line)}</li>
        ))}
      </Tag>
    );
  }
  if (block.kind === 'code') {
    // No syntax highlighting: code blocks in chat are mostly a few lines of commands, not worth a highlighter
    // in the bundle.
    return (
      <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 font-mono text-[13.5px] leading-[1.55] text-[var(--text-dim)]">
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === 'table') {
    const [head, ...body] = block.rows;
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full border-collapse text-left text-[14px]">
          {head ? (
            <thead className="bg-[var(--surface-2)]">
              <tr>
                {head.map((cell, index) => (
                  <th key={index} className="border-b border-[var(--border)] px-2 py-1 font-semibold">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-[var(--border)]/60 last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2 py-1 text-[var(--text-dim)]">{inline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <hr className="border-[var(--border)]" />;
});

function inline(text: string): React.ReactNode[] {
  return parseInlineMarkdown(text).map((piece, index) => {
    if (piece.kind === 'code') {
      return (
        <code key={index} className="rounded bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[0.88em]">
          {piece.text}
        </code>
      );
    }
    if (piece.kind === 'strong') return <strong key={index} className="font-semibold">{withRefs(piece.text)}</strong>;
    if (piece.kind === 'em') return <em key={index} className="italic">{withRefs(piece.text)}</em>;
    if (piece.kind === 'link') {
      return (
        <a
          key={index}
          href={piece.href}
          // Always a new tab: a turn may be running here, and navigating away would lose it.
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
        >
          {piece.text}
        </a>
      );
    }
    return <React.Fragment key={index}>{withRefs(piece.text)}</React.Fragment>;
  });
}

/**
 * The agent's words with what it points at in Studio as pills (lib/agent-refs: `[[clip:s3]]`, `[[t:13.6]]`…). Only
 * in words: what it writes in code stays code, a token there being an example, not a reference.
 */
function withRefs(text: string): React.ReactNode {
  if (!text.includes('[[')) return text;
  const segments = parseAgentRefs(text);
  if (segments.length === 1 && segments[0]!.kind === 'text') return text;
  return segments.map((segment, index) => (segment.kind === 'text'
    ? <React.Fragment key={index}>{segment.text}</React.Fragment>
    : <AgentRefPill key={index} studioRef={segment.ref} />));
}

/** A thing an agent pointed at: read-only, its hover card as a sent pill's, a click shows it in Studio. */
function AgentRefPill({ studioRef }: { studioRef: StudioRef }) {
  const t = useT();
  const ctx = React.useContext(PromptPillRevealContext);
  const clipSrc = useClipSrc(studioRef.kind === 'clip' ? studioRef.id : null);
  const reference = React.useMemo(
    () => agentRefPill(studioRef, { clipSrc, trackLabel: (n) => t('agentRef.track').replace('{n}', String(n)) }),
    [studioRef, clipSrc, t],
  );
  const reveal = ctx?.onReveal;
  const label = ctx?.revealLabel;
  return (
    <PromptPill
      reference={reference}
      card={ctx?.describe?.(reference) ?? null}
      {...(reveal && label ? { hint: label, title: `${reference.label} · ${label}` } : {})}
      {...(reveal ? {
        onClick: (event: React.MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          reveal(reference);
        },
      } : {})}
    />
  );
}
