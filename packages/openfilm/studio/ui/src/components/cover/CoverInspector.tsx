/**
 * The cover design's inspector while nothing is picked on the cover, or its picture is: the picture (where it comes
 * from, its subject cut out onto a layer of its own, blurred behind, fitted to the cover again, another source, drawn
 * again with AI), and the cover's layers, top first, each picked or moved up and down. A picked word or look has the
 * edit's own inspector instead.
 */
import React from 'react';
import { ArrowDown, ArrowUp, Droplet, Image as ImageIcon, Maximize, Scissors, Sparkles, Type } from 'lucide-react';
import { useT } from '@/i18n';

export interface CoverLayer {
  /** the clip's place on the film (what picking it on the timeline would pick) */
  loc: string;
  kind: 'look' | 'picture' | 'subject' | 'words' | 'other';
  name: string;
}

export function CoverInspector({ layers, picture, picked, busy, blurred, onPick, onMove, onCutout, onBlur, onFill, onSource, onAi }: {
  layers: readonly CoverLayer[];
  /** where the picture comes from, said (null: the cover has none) */
  picture: { kind: 'frame' | 'picture' | 'color'; said: string } | null;
  /** the picked layer's place, when one is */
  picked: string | null;
  busy: string | null;
  blurred: boolean;
  onPick: (loc: string) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onCutout: () => void;
  onBlur: (on: boolean) => void;
  onFill: () => void;
  onSource: () => void;
  onAi: () => void;
}) {
  const t = useT();
  const drawable = picture != null && picture.kind !== 'color';
  return (
    <div data-cover-inspector="" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3.5 text-[12.5px] text-[var(--text)]">
      <section>
        <div className="mb-2 flex items-center">
          <span className="font-semibold">{t('covers.picture')}</span>
          <span className="ml-auto truncate pl-2 text-[11.5px] text-[var(--text-faint)]">{picture ? picture.said : t('covers.noPicture')}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Tool icon={<Scissors size={13} />} label={busy === 'cutout' ? t('covers.working') : t('covers.cutout')} tip={t('covers.cutoutTip')} disabled={!drawable || busy != null} onClick={onCutout} />
          <Tool icon={<Droplet size={13} />} label={t('covers.blur')} tip={t('covers.blurTip')} on={blurred} disabled={!drawable} onClick={() => onBlur(!blurred)} />
          <Tool icon={<Maximize size={13} />} label={t('covers.fill')} tip={t('covers.fillTip')} disabled={!picture} onClick={onFill} />
          <Tool icon={<ImageIcon size={13} />} label={t('covers.otherPicture')} tip={t('covers.otherPictureTip')} onClick={onSource} />
        </div>
        <button type="button" onClick={onAi} disabled={busy === 'picture'}
          className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--bg-field)] text-[12px] text-[var(--accent)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50">
          <Sparkles size={13} />{busy === 'picture' ? t('covers.makingPicture') : t('covers.aiEdit')}
        </button>
      </section>

      <section className="border-t border-[var(--border)] pt-3.5">
        <div className="mb-2 font-semibold">{t('covers.layers')}</div>
        <div className="flex flex-col gap-1" role="list">
          {layers.map((l, i) => (
            <div key={l.loc} role="listitem" data-cover-layer={l.kind}
              className={`group flex h-8 items-center gap-2 rounded-md pl-2 pr-1 transition ${picked === l.loc ? 'bg-[var(--bg-selected)]' : 'bg-[var(--bg-field)] hover:bg-[var(--bg-hover)]'}`}>
              <button type="button" onClick={() => onPick(l.loc)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="shrink-0 text-[var(--text-muted)]">{l.kind === 'words' || l.kind === 'look' ? <Type size={13} /> : l.kind === 'subject' ? <Scissors size={13} /> : <ImageIcon size={13} />}</span>
                <span className="truncate">{l.name}</span>
              </button>
              <button type="button" aria-label={t('covers.layerUp')} disabled={i === 0} onClick={() => onMove(i, -1)}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition hover:bg-[var(--bg-pressed)] hover:text-[var(--text)] group-hover:opacity-100 disabled:invisible"><ArrowUp size={13} /></button>
              <button type="button" aria-label={t('covers.layerDown')} disabled={i === layers.length - 1} onClick={() => onMove(i, 1)}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition hover:bg-[var(--bg-pressed)] hover:text-[var(--text)] group-hover:opacity-100 disabled:invisible"><ArrowDown size={13} /></button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-faint)]">{t('covers.layersNote')}</p>
      </section>

      <p className="mt-auto border-t border-[var(--border)] pt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">{t('covers.askAgent')}</p>
    </div>
  );
}

function Tool({ icon, label, tip, onClick, on = false, disabled = false }: { icon: React.ReactNode; label: string; tip: string; onClick: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <button type="button" title={tip} aria-pressed={on} disabled={disabled} onClick={onClick}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-[12px] transition disabled:opacity-45 ${on ? 'bg-[var(--bg-selected)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--accent)]' : 'bg-[var(--bg-field)] text-[var(--text)] hover:bg-[var(--bg-hover)]'}`}>
      {icon}{label}
    </button>
  );
}
