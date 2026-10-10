/**
 * References on the editor side: splitting markers, unknown markers, and what they
 * expand to on send.
 *
 * The marker and a reference's stored shape live in `prompt-reference` in
 * `@openfilm/shared`: the text with markers is stored, so it is a shared contract.
 */
import {
  splitPromptReferenceText,
  type PromptReference as StoredPromptReference,
} from '@openfilm/shared';

export {
  promptReferenceToken,
  splitPromptReferenceText,
  stripPromptReferenceTokens,
  type PromptTextSegment,
} from '@openfilm/shared';

/**
 * A reference in the editor.
 *
 * It does not know whether it is an element, a region or a clip; the host translates
 * that. Here it is only an icon, a label, and who handles a click.
 *
 * The shape lives in @openfilm/shared; this narrows `kind` to the kinds the icon table
 * knows, since every pill inserted here needs an icon, while stored references can have
 * kinds this UI does not know (see `promptReferenceSchema`).
 */
export interface PromptReference extends StoredPromptReference {
  kind: PromptReferenceKind;
}

/**
 * clip* = a whole clip on the timeline (an MG, a voice line), unlike time (a moment).
 * file = a file in the project workspace; on send it becomes a path (see below).
 * card = a canvas card. The sentence holds a pointer; the content is read on send.
 * skill = a way of working (a package), not something in the film.
 * range = a span of the film (in to out on the timeline); track = a whole timeline track.
 * subtitle = a subtitle line (or some of its words), with its time in the film.
 *
 * Clips are six kinds rather than one `clip` only for their icons, so an MG, a video and
 * a voice line in one sentence look different.
 */
export type PromptReferenceKind =
  | 'element' | 'region' | 'time' | 'range' | 'track' | 'subtitle' | 'showcase' | 'file' | 'card' | 'skill'
  | 'clipMg' | 'clipVideo' | 'clipVoice' | 'clipSfx' | 'clipMusic' | 'clipCaption';

/* The id prefix of a file reference, followed by the workspace-relative path, which is
   all the reference holds. It is in the id rather than a separate table because the
   agent needs exactly that path (to read it, or put it in <video src>), so the text
   carries it with no translation on send. */
const FILE_REFERENCE_PREFIX = 'file:';

export function fileReferenceId(path: string): string {
  return `${FILE_REFERENCE_PREFIX}${path}`;
}

/** Null if not a file reference (or the path is empty). */
export function fileReferencePath(id: string): string | null {
  if (!id.startsWith(FILE_REFERENCE_PREFIX)) return null;
  return id.slice(FILE_REFERENCE_PREFIX.length) || null;
}

/* The id prefix of a skill reference, followed by the package name (as imported). As
   with files, the name is all the reference holds, so it expands without the host, even
   for a draft restored from localStorage with no references loaded. */
const SKILL_REFERENCE_PREFIX = 'skill:';

export function skillReferenceId(packageName: string): string {
  return `${SKILL_REFERENCE_PREFIX}${packageName}`;
}

/** Null if not a skill reference (or the package name is empty). */
export function skillReferencePackage(id: string): string | null {
  if (!id.startsWith(SKILL_REFERENCE_PREFIX)) return null;
  return id.slice(SKILL_REFERENCE_PREFIX.length) || null;
}

/** The skill packages this message names, deduplicated, in order. */
export function activatedSkillIds(
  references: readonly { id: string }[] | undefined,
): string[] {
  if (!references?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of references) {
    const name = skillReferencePackage(ref.id);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Replaces the markers in the text with what the model reads.
 *
 * `render` gets the index of the reference's first appearance (from 1), in the same order
 * as the references sent with the request, which is how the prompt lists the referenced
 * context. That is how the model knows which item "make this blue" means.
 *
 * `render` returning null means unknown (a draft restored from localStorage with no
 * references loaded, or an undo bringing back a sent pill): it is dropped and takes no
 * number. The numbers must match collectPromptReferences exactly; an off-by-one raises
 * no error, it just makes the model edit the wrong thing.
 *
 * File references are the exception: they become the path in the id, skip `render`, and
 * take no number. No render, because a path needs no translation, and after a draft
 * restore render would drop it as unknown. No number, because files are not in the
 * references sent with the request (that list holds only timestamp, region and element),
 * so numbering them would shift every later reference.
 *
 * `verbatim` opens the same exception to others: any reference that explains itself and
 * is not in that list expands as is, without a number. Canvas cards use it.
 */
export function resolvePromptReferences(
  text: string,
  render: (id: string, index: number) => string | null,
  verbatim?: (id: string) => string | null,
): string {
  const order = new Map<string, number>();
  let out = '';
  for (const segment of splitPromptReferenceText(text)) {
    if (segment.kind === 'text') {
      out += segment.value;
      continue;
    }
    const { id } = segment;
    const path = fileReferencePath(id);
    if (path) {
      out += path;
      continue;
    }
    const raw = verbatim?.(id);
    if (raw != null) {
      out += raw;
      continue;
    }
    const seen = order.get(id);
    if (seen != null) {
      out += render(id, seen) ?? '';
      continue;
    }
    const next = order.size + 1;
    const rendered = render(id, next);
    if (rendered == null) continue;
    order.set(id, next);
    out += rendered;
  }
  return out;
}

/** The references used in the text, deduplicated, in order; the order is the numbering. */
export function collectPromptReferences(
  text: string,
  lookup: (id: string) => PromptReference | undefined,
): PromptReference[] {
  const seen = new Set<string>();
  const out: PromptReference[] = [];
  for (const segment of splitPromptReferenceText(text)) {
    if (segment.kind === 'text') continue;
    const { id } = segment;
    if (seen.has(id)) continue;
    seen.add(id);
    const reference = lookup(id);
    /* Unknown markers are dropped rather than kept as empty references. */
    if (reference) out.push(reference);
  }
  return out;
}
