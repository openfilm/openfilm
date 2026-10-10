'use client';

/**
 * How a pill looks; drawing only, not where it comes from.
 *
 * Shared by the pill in the editor (a Lexical decorator node, clickable and removable)
 * and the pill in a sent message (read-only), so the sentence looks the same after send.
 *
 * It must not touch Lexical: `useLexicalComposerContext` throws outside a composer, so
 * the caller passes things like the remove button through `trailing`.
 */

import React from 'react';
import {
  Blocks, Brackets, Captions, Clock3, Crop, Film, LocateFixed, Mic, MousePointer2, Music, Paperclip,
  Quote, Rows3, Shapes, SquareDashed, Video, Waves,
} from 'lucide-react';
import {
  splitPromptReferenceText,
  type PromptDisplay,
  type PromptReference as StoredPromptReference,
} from '@openfilm/shared';
import { Tooltip } from '@/components/Tooltip';
import type { PromptReferenceKind } from './prompt-text';

/* The `@` menu uses this table too, so a menu row and the pill it becomes share an icon. */
export const PILL_ICON: Record<PromptReferenceKind, React.ComponentType<{ size?: number; className?: string }>> = {
  element: MousePointer2,
  region: Crop,
  time: Clock3,
  /* A range: the in and out brackets, as marked on the timeline ruler. */
  range: Brackets,
  /* A whole track: rows, matching the timeline. */
  track: Rows3,
  /* A subtitle line: quotes, since the label is the spoken words themselves. */
  subtitle: Quote,
  showcase: Film,
  /* Files get one icon regardless of video, image or audio: the file name says which,
     and a paperclip reads more clearly than three similar file icons. */
  file: Paperclip,
  /* A canvas card: an empty frame. Text and image cards share it; the name says which. */
  card: SquareDashed,
  /* A skill: blocks, a piece of craft inserted into the sentence. Other pills point at
     things in the film; this one points at a way of working. */
  skill: Blocks,
  /* Timeline clips: the icon follows the clip's kind on the timeline, so the pill
     matches the clip the user just picked. */
  clipMg: Shapes,
  clipVideo: Video,
  clipVoice: Mic,
  clipSfx: Waves,
  clipMusic: Music,
  clipCaption: Captions,
};

/**
 * Unknown kinds fall back to a paperclip.
 *
 * A stored `kind` is a string, not this table's enum (see `promptReferenceSchema` in
 * @openfilm/shared): kinds come and go, but old messages keep theirs. A missing icon is
 * better than a message that fails to render.
 */
function iconFor(kind: string): React.ComponentType<{ size?: number; className?: string }> {
  return PILL_ICON[kind as PromptReferenceKind] ?? Paperclip;
}

/**
 * Each kind's color, drawn on the icon's small square.
 *
 * Clips use the timeline's colors (`--tl-*`), so a pill matches its clip. Things in the
 * picture (an element, a region) use the selection blue they light up in. Times use
 * amber, apart from the playhead's colors. Things outside the film (files, canvas cards,
 * skills) have no color.
 */
const PILL_TONE: Partial<Record<PromptReferenceKind, string>> = {
  element: '#0d99ff',
  region: '#0d99ff',
  time: '#d48a1f',
  range: '#d48a1f',
  subtitle: 'var(--tl-caption)',
  clipMg: 'var(--tl-scene)',
  clipVideo: 'var(--tl-video)',
  clipVoice: 'var(--tl-voice)',
  clipSfx: 'var(--tl-sfx)',
  clipMusic: 'var(--tl-music)',
  clipCaption: 'var(--tl-caption)',
};

/**
 * Kinds that lead somewhere in the film when clicked (seek there, point it out in the
 * picture). Files and showcases point outside the film; the canvas moves to its own cards.
 */
const REVEALABLE_PILL_KINDS = new Set<string>([
  'element', 'region', 'time', 'range', 'track', 'subtitle', 'card',
  'clipMg', 'clipVideo', 'clipVoice', 'clipSfx', 'clipMusic', 'clipCaption',
]);

/**
 * Whether clicking leads somewhere: the kind points into the film, or the host recorded
 * what it points at (`target`), such as a file dragged in from Studio's assets.
 */
export function canRevealPill(reference: StoredPromptReference): boolean {
  return Boolean(reference.target) || REVEALABLE_PILL_KINDS.has(reference.kind);
}

/** A pill's hover card: what it is, and label/value rows (already translated by the host). */
export interface PromptPillCard {
  title: string;
  rows: Array<[string, string]>;
}

type PillImage = NonNullable<StoredPromptReference['image']>;

/* Each picture is loaded once, since many pills can show the same frame. */
const pictureState = new Map<string, 'ok' | 'failed' | Promise<void>>();

/** Whether the picture loads. If not (the film changed, the project closed), the pill shows its icon instead. */
function usePictureLoads(src: string | undefined): boolean {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const state = src ? pictureState.get(src) : undefined;
  React.useEffect(() => {
    if (!src) return;
    let current = pictureState.get(src);
    if (!current) {
      current = new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => { pictureState.set(src, 'ok'); resolve(); };
        img.onerror = () => { pictureState.set(src, 'failed'); resolve(); };
        img.src = src;
      });
      pictureState.set(src, current);
    }
    if (current instanceof Promise) {
      let live = true;
      void current.then(() => { if (live) bump(); });
      return () => { live = false; };
    }
    return undefined;
  }, [src]);
  return Boolean(src) && state !== 'failed';
}

/** The thumbnail's aspect ratio: that of the crop (or the whole frame), clamped so the pill keeps its shape. */
function pictureAspect(image: PillImage): number {
  const shape = image.crop ?? image.stage;
  const aspect = shape && shape.h > 0 ? shape.w / shape.h : 16 / 9;
  return Math.min(Math.max(aspect, 1), 16 / 9);
}

/**
 * A background showing only the `crop`: grown to the thumbnail's shape (no stretching),
 * then turned into background size and position. Percentages are relative to the
 * thumbnail, so they hold at any font size.
 */
function pictureStyle(image: PillImage, aspect: number): React.CSSProperties {
  const backgroundImage = `url(${JSON.stringify(image.src)})`;
  const { crop, stage } = image;
  if (!crop || !stage || crop.w <= 0 || crop.h <= 0) return { backgroundImage, backgroundSize: 'cover', backgroundPosition: 'center' };
  let { x, y, w, h } = crop;
  if (w / h < aspect) { const grown = h * aspect; x -= (grown - w) / 2; w = grown; } else { const grown = w / aspect; y -= (grown - h) / 2; h = grown; }
  w = Math.min(w, stage.w);
  h = Math.min(h, stage.h);
  x = Math.min(Math.max(x, 0), stage.w - w);
  y = Math.min(Math.max(y, 0), stage.h - h);
  return {
    backgroundImage,
    backgroundSize: `${(stage.w / w) * 100}% ${(stage.h / h) * 100}%`,
    backgroundPosition: `${stage.w > w ? (x / (stage.w - w)) * 100 : 0}% ${stage.h > h ? (y / (stage.h - h)) * 100 : 0}%`,
  };
}

/** The card's picture: the whole frame, with the crop outlined in blue and the rest dimmed. */
function PillCardPicture({ image }: { image: PillImage }) {
  const { crop, stage } = image;
  const box = crop && stage && stage.w > 0 && stage.h > 0 ? {
    left: `${(crop.x / stage.w) * 100}%`,
    top: `${(crop.y / stage.h) * 100}%`,
    width: `${(crop.w / stage.w) * 100}%`,
    height: `${(crop.h / stage.h) * 100}%`,
  } : null;
  return (
    <div className="relative overflow-hidden rounded-[5px] bg-black/40">
      <img src={image.src} alt="" className="block h-auto w-full" draggable={false} />
      {box ? (
        <div
          aria-hidden
          className="absolute rounded-[2px] border-[1.5px] border-[#0d99ff] shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          style={box}
        />
      ) : null}
    </div>
  );
}

function PillCardBody({ card, image, hint }: { card?: PromptPillCard | null; image?: PillImage | null; hint?: string }) {
  return (
    <div className="flex w-[240px] flex-col gap-1.5 whitespace-normal py-0.5 text-left">
      {image ? <PillCardPicture image={image} /> : null}
      {card ? (
        <>
          <div className="text-[11.5px] font-semibold">{card.title}</div>
          {card.rows.length ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px] font-normal leading-snug">
              {card.rows.map(([label, value], index) => (
                <React.Fragment key={index}>
                  <dt className="opacity-60">{label}</dt>
                  <dd className="break-words font-mono tabular-nums">{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : null}
        </>
      ) : null}
      {hint ? <div className="text-[10.5px] font-normal opacity-60">{hint}</div> : null}
    </div>
  );
}

/**
 * Links a pill and what it points at, both ways: hovering a pill lights the thing up
 * elsewhere (`hover`, null on leave); pointing at a thing elsewhere lights its pills
 * (`lit`, with `subscribe` notifying changes). A context, because pills in the editor,
 * sent messages, agent replies and the changes list are all PromptPill.
 */
export interface PromptPillHover {
  hover: (reference: StoredPromptReference | null) => void;
  lit: (reference: StoredPromptReference) => boolean;
  subscribe: (listener: () => void) => () => void;
}
export const PromptPillHoverContext = React.createContext<PromptPillHover | null>(null);
const noSubscribe = () => () => {};

export function PromptPill({
  reference,
  onClick,
  title,
  trailing,
  card,
  hint,
}: {
  reference: StoredPromptReference;
  /** Only when clicking leads somewhere; without it the pill is read-only. */
  onClick?: (event: React.MouseEvent) => void;
  title?: string;
  /** The trailing slot: the remove button in the editor, nothing in history. */
  trailing?: React.ReactNode;
  /** The hover card's facts; with neither these nor a picture there is no card, only the native title. */
  card?: PromptPillCard | null;
  /** The small line under the card (what clicking does), since the card replaces the native title. */
  hint?: string;
}) {
  const Icon = iconFor(reference.kind);
  const tone = PILL_TONE[reference.kind as PromptReferenceKind];
  const image = reference.image;
  const pictured = usePictureLoads(image?.src) && image ? image : null;
  const aspect = pictured ? pictureAspect(pictured) : 1;
  const hoverCard = pictured || card;
  const hoverCtx = React.useContext(PromptPillHoverContext);
  const lit = React.useSyncExternalStore(hoverCtx?.subscribe ?? noSubscribe, () => hoverCtx?.lit(reference) ?? false);
  /* If the pill goes away while hovered (removed, sent), turn off what it lit elsewhere */
  const hovering = React.useRef(false);
  React.useEffect(() => () => { if (hovering.current) hoverCtx?.hover(null); }, [hoverCtx]);

  const pill = (
    <span
      contentEditable={false}
      onClick={onClick}
      onMouseEnter={hoverCtx ? () => { hovering.current = true; hoverCtx.hover(reference); } : undefined}
      onMouseLeave={hoverCtx ? () => { hovering.current = false; hoverCtx.hover(null); } : undefined}
      /* No native title with a card: the system one would appear on top of it a second later */
      title={hoverCard ? undefined : title ?? reference.label}
      /* A fixed height below the line height, so a pill does not make the line taller.
         `vertical-align: middle` centers the box on baseline + half the x-height, so the
         part below the baseline must fit in the line box too. 1.45em (the pill's own font
         size) is 18.7px at 14px/22px, with room on both sides. */
      className={`group/pill mx-[1px] inline-flex h-[1.45em] max-w-[240px] select-none items-center gap-[5px] rounded-[6px] pl-[3px] align-middle text-[0.9em] font-medium leading-none text-[var(--text)] ring-1 ring-inset transition-[background-color,box-shadow] ${
        trailing ? 'pr-[3px]' : 'pr-1.5'
      } ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        background: tone
          ? `color-mix(in srgb, ${tone} ${onClick ? 11 : 9}%, var(--surface))`
          : 'var(--surface-2)',
        ['--tw-ring-color' as string]: tone ? `color-mix(in srgb, ${tone} 26%, transparent)` : 'var(--border)',
        ...(tone ? { ['--pill-tone' as string]: tone } : {}),
        /* Lit from elsewhere: a solid border (over the faint ring) and a deeper fill */
        ...(lit ? {
          background: tone ? `color-mix(in srgb, ${tone} 24%, var(--surface))` : 'var(--bg-hover)',
          boxShadow: `inset 0 0 0 1.5px ${tone ?? 'var(--text-muted)'}`,
        } : {}),
      }}
      data-pill-kind={reference.kind}
      data-pill-lit={lit ? '' : undefined}
    >
      {pictured ? (
        /* A picture replaces the icon: it shows what part of the frame is meant */
        <span
          aria-hidden
          className="h-[1.05em] shrink-0 rounded-[3px] bg-no-repeat ring-1 ring-inset ring-black/10"
          style={{ width: `${(1.05 * aspect).toFixed(3)}em`, ...pictureStyle(pictured, aspect) }}
        />
      ) : (
        <span
          className="flex h-[1.05em] w-[1.05em] shrink-0 items-center justify-center rounded-[4px]"
          style={tone
            ? { background: tone, color: '#fff' }
            : { background: 'var(--fill-tsp)', color: 'var(--text-muted)' }}
        >
          <Icon size={10} className="shrink-0" />
        </span>
      )}
      <span className="truncate">{reference.label}</span>
      {reference.detail ? (
        <span className="shrink-0 font-normal tabular-nums text-[var(--text-faint)]">{reference.detail}</span>
      ) : null}
      {onClick ? (
        /* Clickable pills show a locate icon on hover: clicking takes you there. */
        <LocateFixed
          size={10}
          aria-hidden
          className="-ml-0.5 hidden shrink-0 text-[var(--pill-tone,var(--text-muted))] group-hover/pill:block"
        />
      ) : null}
      {trailing}
    </span>
  );
  if (!hoverCard) return pill;
  return (
    <Tooltip label={reference.label} content={<PillCardBody card={card} image={pictured} {...(onClick && hint ? { hint } : {})} />}>
      {pill}
    </Tooltip>
  );
}

/**
 * A sent message: text as text, references as pills.
 *
 * Unknown markers are dropped, not shown raw: raw, a marker reads like
 * `file:assets/upload/x.mp4` in the middle of the sentence. Same as
 * `collectPromptReferences` treats unknown references.
 */
/**
 * Where sent pills lead when clicked. A context rather than props: the conversation is a
 * memoized list (see ProjectConversation), not worth rebuilding every turn for a callback.
 */
export const PromptPillRevealContext = React.createContext<{
  onReveal: (reference: StoredPromptReference) => void;
  revealLabel?: string;
  /** What the hover card says (the host knows what the pill points at; this layer does not). */
  describe?: (reference: StoredPromptReference) => PromptPillCard | null;
} | null>(null);

export function PromptWithPills({
  display,
  onReveal,
  revealLabel,
}: {
  display: PromptDisplay;
  /** Clicking a pill in history: seek to its moment and point it out in the picture, as in the editor. */
  onReveal?: (reference: StoredPromptReference) => void;
  revealLabel?: string;
}) {
  const byId = React.useMemo(
    () => new Map(display.references.map((item) => [item.id, item])),
    [display.references],
  );
  const ctx = React.useContext(PromptPillRevealContext);
  const onRevealRef = onReveal ?? ctx?.onReveal;
  const label = revealLabel ?? ctx?.revealLabel;

  return (
    <>
      {splitPromptReferenceText(display.text).map((segment, index) => {
        if (segment.kind === 'text') {
          return <React.Fragment key={index}>{segment.value}</React.Fragment>;
        }
        const reference = byId.get(segment.id);
        if (!reference) return null;
        const reveal = onRevealRef && canRevealPill(reference) ? onRevealRef : undefined;
        return (
          <PromptPill
            key={index}
            reference={reference}
            card={ctx?.describe?.(reference) ?? null}
            {...(reveal && label ? { hint: label } : {})}
            {...(reveal ? {
              onClick: (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                reveal(reference);
              },
            } : {})}
            {...(reveal && label ? { title: `${reference.label} · ${label}` } : {})}
          />
        );
      })}
    </>
  );
}
