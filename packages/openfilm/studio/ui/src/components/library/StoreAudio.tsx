/**
 * The Community's sounds and music in the store, heard as the library drawer hears them (AudioList): a sound a row (its
 * tile with its mark, its name, length and waveform), a piece of music a card (its tile, name and length); a click plays
 * it at once, the tile turning while it comes, and the player bar at the foot of the page plays, pauses and scrubs. The
 * sounds of a page are fetched quietly as it opens, so a click is heard straight away; music streams as it is fetched.
 */
import React from 'react';
import { useLanguage, useT } from '@/i18n';
import { fetchLibraryItem, isLibraryItemReady, nameOf, type LibraryItem } from '@/lib/library';
import { lengthOf, MiniPlayer, Tile, usePlayer, Wave } from './AudioList';

type Lang = ReturnType<typeof useLanguage>;

/** How many sounds are fetched at once ahead of a click. */
const AHEAD = 2;

export function StoreAudio({ items, lang }: { items: readonly LibraryItem[]; lang: Lang }) {
  const t = useT();
  const player = usePlayer<LibraryItem>(() => {});
  const music = items.some((it) => it.cat === 'music');

  /* the page's sounds fetched ahead, a couple at a time (music is too large: it streams on its click) */
  const ids = items.filter((it) => it.cat === 'sound').map((it) => it.id).join('\n');
  React.useEffect(() => {
    let live = true;
    const queue = ids ? ids.split('\n').filter((id) => !isLibraryItemReady(id)) : [];
    const next = async (): Promise<void> => {
      const id = queue.shift();
      if (!id || !live) return;
      await fetchLibraryItem(id);
      return next();
    };
    for (let i = 0; i < AHEAD; i += 1) void next();
    return () => { live = false; };
  }, [ids]);

  React.useEffect(() => player.close, [player.close]);
  const playing = player.item;

  return (
    <div data-store-audio={music ? 'music' : 'sound'}>
      <div className={music ? 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5' : 'grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-x-3 gap-y-1'}>
        {items.map((it) => {
          const mine = playing?.id === it.id;
          const name = nameOf(it.name, lang);
          const busy = mine && (player.playing || player.loading);
          const tile = <Tile item={it} playing={busy} loading={mine && player.loading} size={music ? 64 : 44} cover={it.cat === 'music'} />;
          const on = mine ? 'bg-[var(--bg-field)]' : 'hover:bg-[var(--bg-field)]';
          if (it.cat === 'music') {
            return (
              <button key={it.id} type="button" onClick={() => player.toggle(it)} aria-label={name} aria-pressed={mine && player.playing}
                data-library-audio={it.id} data-audio-preview={mine ? player.status : undefined}
                className={`group flex h-[80px] items-center gap-3 rounded-xl p-2 text-left ring-1 ${mine ? 'bg-[var(--bg-field)] ring-[var(--accent)]' : 'bg-[var(--bg-raised)] ring-transparent hover:bg-[var(--bg-field)]'}`}>
                {tile}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={`line-clamp-2 text-[13px] font-medium leading-[18px] ${mine ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{name}</span>
                  <span className="truncate text-[11.5px] tabular-nums text-[var(--text-faint)]">{lengthOf(it.durationMs ?? 0, t)}</span>
                </span>
              </button>
            );
          }
          return (
            <button key={it.id} type="button" onClick={() => player.toggle(it)} aria-label={name} aria-pressed={mine && player.playing}
              data-library-audio={it.id} data-audio-preview={mine ? player.status : undefined}
              className={`group grid h-[60px] grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 text-left ${on}`}>
              {tile}
              <span className="flex min-w-0 flex-col justify-center gap-1">
                <span className="flex h-5 min-w-0 items-center gap-2">
                  <span className={`truncate text-[13px] font-medium ${mine ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{name}</span>
                  <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-[var(--text-faint)]">{lengthOf(it.durationMs ?? 0, t)}</span>
                </span>
                <span className="flex h-4 min-w-0 items-center">
                  <Wave item={it} played={mine && player.duration ? player.time / player.duration : 0} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {/* the player bar, held at the foot of the page while something is chosen */}
      {playing ? (
        <div className="sticky bottom-0 z-10 -mx-1 mt-4 overflow-hidden rounded-[12px] bg-[var(--dialog-main)] shadow-[0_-8px_24px_rgba(0,0,0,0.25)] ring-1 ring-[var(--border)]">
          <MiniPlayer target={null} player={player} name={nameOf(playing.name, lang)} />
        </div>
      ) : null}
    </div>
  );
}
