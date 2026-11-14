/**
 * What an agent points at in Studio, in its reply: a Markdown link to the project (lib/links in Studio), the same links
 * the person's references reach it as. The chat draws one as a pill, the same pill the person's own references are,
 * which lights the place in Studio under the pointer and opens it when pressed:
 *
 *   [words](film.html#s3)                              a clip, by its film.html id
 *   [words](film.html#t=12.5)                          a moment of the film
 *   [words](film.html#t=12,16)                         a stretch of it, in seconds
 *   [words](film.html#t=12.5&xywh=640,200,320,180)     a part of the picture then (the stage's pixels)
 *   [words](assets/music.mp3)                          a file of the project
 *
 * Before these links, agents were taught tokens between double brackets ([[clip:<id>]], [[t:<s>]], [[range:<a>-<b>]],
 * [[track:<n>]], [[file:<path>]]); those in conversations kept from then are still drawn as pills. Anything else
 * between double brackets (an unknown kind, a number that is not one, a path out of the project) stays as written: a
 * pill that leads nowhere would be worse than the words.
 *
 * Pure: no React, no bridge, so `node --test` runs it (src/agent-refs.test.mjs).
 */
import type { PromptReference as StoredPromptReference } from '@openfilm/shared';
import type { StudioRef } from '../app-bridge';
import { kindOf, soundRole } from 'openfilm/film-doc';
import { refPill } from '../studio-refs.ts';
import { boxOf, parseLink, timeOf } from 'openfilm/studio-ui/lib/links.ts';

export type AgentRefSegment = { kind: 'text'; text: string } | { kind: 'ref'; ref: StudioRef; raw: string };

const TOKEN = /\[\[([a-z]+):([^\[\]\n]{1,300})\]\]/g;
const SECONDS = /^\d+(?:\.\d+)?$/;

/** The reference a token's kind and value name, or null when they name none. */
function refOf(kind: string, value: string): StudioRef | null {
  const v = value.trim();
  switch (kind) {
    case 'clip':
      return /^[^\s"'<>`]{1,120}$/.test(v)
        ? { kind: 'clip', id: v, loc: null, label: v, clipKind: 'mg', src: null, start: 0, end: 0 }
        : null;
    case 't':
      return SECONDS.test(v) ? { kind: 'time', time: Number(v) } : null;
    case 'range': {
      /* an agent writes an en dash as often as a hyphen */
      const m = /^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/.exec(v);
      if (!m) return null;
      const start = Number(m[1]);
      const end = Number(m[2]);
      return end > start ? { kind: 'range', start, end, clipIds: [] } : null;
    }
    case 'track':
      return /^\d{1,3}$/.test(v) ? { kind: 'track', track: Number(v), label: '', clipIds: [] } : null;
    case 'file': {
      /* a path in the project: not from the disk's root, not out of the folder, not an address */
      const path = v.replace(/^\.\//, '');
      if (!path || path.startsWith('/') || /^[a-z]:[\\/]/i.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
      if (path.split(/[\\/]/).some((part) => part === '..')) return null;
      return { kind: 'file', path, fileKind: '' };
    }
    default:
      return null;
  }
}

/**
 * The reference a link to the project stands for: on the film, a part of the picture at a moment, a moment, a stretch
 * or a clip by its id; a file of the project (what after `#` left to Studio). Null for the film itself, a link out of
 * the project, or a thing in a plugin's own file (a link stays a link then).
 */
export function refOfLink(href: string): StudioRef | null {
  const link = parseLink(href);
  if (!link) return null;
  if (link.path === 'film.html') {
    if (!link.fragment) return null;
    const time = timeOf(link.fragment);
    const box = boxOf(link.fragment);
    if (time) {
      const at = 'at' in time ? time.at : time.start;
      if (box) return { kind: 'region', time: at, box, clipIds: [], texts: [] };
      return 'at' in time ? { kind: 'time', time: at } : { kind: 'range', start: time.start, end: time.end, clipIds: [] };
    }
    return /[=&]/.test(link.fragment) ? null : refOf('clip', link.fragment);
  }
  if (link.path.startsWith('.film/')) return null;
  return refOf('file', link.path);
}

/** A piece of the agent's text, split into its words and the references in it. */
export function parseAgentRefs(text: string): AgentRefSegment[] {
  const out: AgentRefSegment[] = [];
  const pushText = (chunk: string) => {
    if (!chunk) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += chunk;
    else out.push({ kind: 'text', text: chunk });
  };
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const ref = refOf(match[1]!, match[2]!);
    if (!ref) continue;
    pushText(text.slice(cursor, match.index));
    out.push({ kind: 'ref', ref, raw: match[0] });
    cursor = match.index! + match[0].length;
  }
  pushText(text.slice(cursor));
  return out;
}

/**
 * The pill for a reference an agent wrote. A clip's kind (and so its icon) comes from its file, when the film it is in
 * is known (`clipSrc`); a clip the film does not have gets the neutral icon. `trackLabel` names a track in the chat's
 * language.
 */
export function agentRefPill(ref: StudioRef, { clipSrc, trackLabel }: { clipSrc?: string | null; trackLabel?: (track: number) => string } = {}): StoredPromptReference {
  if (ref.kind === 'clip') {
    const target: StudioRef = { ...ref, ...(clipSrc ? { src: clipSrc } : {}) };
    return { id: `agent:clip:${ref.id}`, kind: clipSrc ? clipPillKind(clipSrc) : 'clip', label: ref.id ?? ref.label, target: target as unknown as Record<string, unknown> };
  }
  const pill = refPill(undefined, ref);
  return { ...pill, id: `agent:${pill.id}`, ...(ref.kind === 'track' && trackLabel ? { label: trackLabel(ref.track) } : {}) };
}

/**
 * The kind of pill (and so its icon) for a clip of this file, as the timeline colors it: a page is a motion graphic,
 * a video or a still is a picture, a sound is a voice, a sound effect or music by where it lives.
 */
export function clipPillKind(src: string, sound = false): 'clipMg' | 'clipVideo' | 'clipVoice' | 'clipSfx' | 'clipMusic' {
  const kind = kindOf({ src, ...(sound ? { sound: true } : {}) });
  if (kind === 'page') return 'clipMg';
  if (kind === 'sound') {
    const role = soundRole(src);
    return role === 'sfx' ? 'clipSfx' : role === 'music' ? 'clipMusic' : 'clipVoice';
  }
  return 'clipVideo';
}
