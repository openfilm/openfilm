/**
 * A clip's animation (lib/clip-presets): how it comes in, goes out and moves while it shows, one of the library's
 * motions in each. In, Out and Loop, a dot on each that has one; a square card for every motion of the one shown, drawn
 * on the clip's own picture in the middle of its move and playing it under the pointer, None first and the one on lit;
 * then how long the one on takes (In and Out together fit in the clip).
 */
import * as React from 'react';
import { Ban } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { nameOf, useLibraryIndex, type LibraryItem } from '@/lib/library';
import { cardBody, clipMotions, PRESET_SLOTS, type Preset, type PresetSlot } from '@/lib/clip-presets';
import { Section, Segmented, SliderField } from './inspector-fields';

export interface ClipMotionHost {
  /** the clip's picture for the cards (null: none to show) */
  picture: string | null;
  /** it fills its card (a video's, a picture's), else it sits in it (a page's, a sticker's) */
  cover: boolean;
  /** what it has on in each slot */
  on: Partial<Record<PresetSlot, { name: string; secs: number }>>;
  /** the clip's length, in seconds */
  lengthSecs: number;
  /** a motion put in a slot, at its time (null: the slot's taken off) */
  put: (slot: PresetSlot, preset: Preset | null) => void;
}

/* the slot shown last, shown again for the next clip */
let lastSlot: PresetSlot = 'in';
/* how far into its move a card stands still: an in mostly in, an out starting to go */
const POSE: Record<PresetSlot, number> = { in: 0.45, out: 0.55, loop: 0.25 };
/* a card is a small part of the stage: its blurs a little more than in proportion, to be seen */
const CARD_BLUR = 0.15;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function ClipMotionSection({ host }: { host: ClipMotionHost }) {
  const t = useT();
  const lang = useLanguage();
  const index = useLibraryIndex();
  const [slot, setSlotState] = React.useState<PresetSlot>(lastSlot);
  const setSlot = (next: PresetSlot) => { lastSlot = next; setSlotState(next); };
  const items = clipMotions(index?.items ?? [], slot);
  const now = host.on[slot];
  const nowItem = now ? items.find((i) => i.motion?.[slot]?.name === now.name) ?? null : null;
  /* In and Out share the clip: each may take what the other leaves; a loop is one round */
  const other = slot === 'in' ? host.on.out?.secs ?? 0 : slot === 'out' ? host.on.in?.secs ?? 0 : 0;
  const room = slot === 'loop' ? 10 : Math.max(0.1, round1(host.lengthSecs - other));
  const pick = (item: LibraryItem | null) => {
    const preset = item?.motion?.[slot];
    if (!preset) { if (now) host.put(slot, null); return; }
    host.put(slot, { ...preset, secs: slot === 'loop' ? preset.secs : Math.min(preset.secs, room) });
  };
  const keyframes = items.map((i) => {
    const p = i.motion![slot]!;
    return `@keyframes card-${p.name} { ${cardBody(p.body, CARD_BLUR)} }`;
  }).join('\n');
  return (
    <Section id="motion" title={t('clipMotion.title')}>
      <Segmented
        label={t('clipMotion.title')}
        value={slot}
        options={PRESET_SLOTS.map((s) => ({
          value: s,
          label: (
            <span data-motion-slot={s} className="inline-flex items-center gap-1">
              {t(`clipMotion.${s}`)}
              {host.on[s] ? <span className="h-1 w-1 rounded-full bg-[var(--accent)]" /> : null}
            </span>
          ),
        }))}
        onChange={(v) => setSlot(v as PresetSlot)}
      />
      <style>{keyframes}</style>
      <div className="grid grid-cols-4 gap-x-1.5 gap-y-2">
        <button type="button" data-motion-card="" onClick={() => pick(null)} className="min-w-0 text-left">
          <span className={`grid aspect-square place-items-center rounded-[6px] bg-[var(--bg-field)] text-[var(--text-faint)] ${ring(!now)}`}><Ban size={16} /></span>
          <span className={label(!now)}>{t('clipMotion.none')}</span>
        </button>
        {items.map((item) => (
          <Card key={item.id} item={item} preset={item.motion![slot]!} slot={slot} host={host} lit={nowItem?.id === item.id}
            name={nameOf(item.name, lang)} onPick={() => pick(item)} />
        ))}
      </div>
      {now && nowItem ? (
        <SliderField
          label={t('clipMotion.time')}
          value={round1(now.secs)}
          min={0.1}
          max={Math.max(room, round1(now.secs))}
          step={0.1}
          neutral={Math.min(nowItem.motion![slot]!.secs, room)}
          unit="s"
          onCommit={(n) => { if (n !== round1(now.secs)) host.put(slot, { ...nowItem.motion![slot]!, secs: Math.max(0.1, n) }); }}
        />
      ) : null}
    </Section>
  );
}

const ring = (lit: boolean) => (lit ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-[var(--border)] hover:ring-[var(--text-faint)]');
const label = (lit: boolean) => `mt-1 block truncate text-center text-[10.5px] ${lit ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-muted)]'}`;

/** One motion's card: the clip's picture standing in the middle of the move, playing it from the start under the pointer. */
function Card({ item, preset, slot, host, lit, name, onPick }: {
  item: LibraryItem; preset: Preset; slot: PresetSlot; host: ClipMotionHost; lit: boolean; name: string; onPick: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  /* an in or an out played again and again, a moment between */
  const [round, setRound] = React.useState(0);
  React.useEffect(() => {
    if (!hover || slot === 'loop') return undefined;
    const id = window.setInterval(() => setRound((r) => r + 1), preset.secs * 1000 + 700);
    return () => window.clearInterval(id);
  }, [hover, slot, preset.secs]);
  const name_ = `card-${preset.name}`;
  const animation = hover
    ? `${name_} ${preset.secs}s ${preset.ease} 0s ${slot === 'loop' ? 'infinite' : '1'} normal both running`
    : `${name_} ${preset.secs}s ${preset.ease} ${-POSE[slot] * preset.secs}s 1 normal both paused`;
  return (
    <button type="button" data-motion-card={item.id} title={name} onClick={onPick} className="min-w-0 text-left"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setRound(0); }}>
      <span className={`relative block aspect-square overflow-hidden rounded-[6px] bg-[var(--bg-field)] ${ring(lit)}`}>
        {host.picture ? (
          <span key={round} className="absolute inset-0 bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${JSON.stringify(host.picture)})`, backgroundSize: host.cover ? 'cover' : 'contain', animation }} />
        ) : (
          /* nothing to show: a plain card moves */
          <span key={round} className="absolute inset-[22%] rounded-[4px] bg-[var(--text-faint)]" style={{ animation }} />
        )}
      </span>
      <span className={label(lit)}>{name}</span>
    </button>
  );
}
