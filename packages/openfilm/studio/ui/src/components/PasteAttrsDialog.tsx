import React from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { groupsOf, type AttrGroup, type CopiedAttrs } from '@/lib/clip-attrs';
import { Card, CardActions, CardButton } from './Card';

/**
 * Paste attributes (⌘⇧V): what the copied clip has, in two parts — its picture (place and size,
 * blending) and its sound (volume, fades) — each ticked, untick what should stay. Enter pastes, Esc backs out.
 */
export function PasteAttrsDialog({
  attrs, onPaste, onCancel,
}: {
  /** The copy; null: closed. */
  attrs: CopiedAttrs | null;
  onPaste: (groups: ReadonlySet<AttrGroup>) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const offered = React.useMemo(() => (attrs ? groupsOf(attrs) : []), [attrs]);
  const [picked, setPicked] = React.useState<ReadonlySet<AttrGroup>>(new Set());
  const pasteRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { setPicked(new Set(offered)); }, [offered]);
  React.useEffect(() => {
    if (!attrs) return undefined;
    pasteRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attrs, onCancel]);
  if (!attrs || typeof document === 'undefined') return null;

  const parts: { title: string; groups: AttrGroup[] }[] = [
    { title: t('clipAttrs.picture'), groups: offered.filter((g) => g === 'place' || g === 'blend') },
    { title: t('clipAttrs.sound'), groups: offered.filter((g) => g === 'volume' || g === 'fade') },
  ].filter((p) => p.groups.length);
  const flip = (g: AttrGroup) => setPicked((now) => {
    const next = new Set(now);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  });

  return createPortal(
    <div className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={onCancel}>
      <div className="w-full max-w-[360px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('clipAttrs.title')}>
        <Card title={t('clipAttrs.title')} onClose={onCancel}>
          <div className="mt-2 flex flex-col gap-3">
            {parts.map((part) => (
              <fieldset key={part.title} className="flex flex-col gap-1.5">
                <legend className="mb-1 text-[11px] text-[var(--text-faint)]">{part.title}</legend>
                {part.groups.map((g) => (
                  <label key={g} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--text)]">
                    <input type="checkbox" checked={picked.has(g)} onChange={() => flip(g)} data-attr-group={g} />
                    {t(`clipAttrs.${g}`)}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <CardActions>
            <CardButton weight="quiet" onClick={onCancel}>{t('confirm.cancel')}</CardButton>
            <CardButton ref={pasteRef} weight="primary" disabled={!picked.size} onClick={() => onPaste(picked)}>{t('clipAttrs.paste')}</CardButton>
          </CardActions>
        </Card>
      </div>
    </div>,
    document.body,
  );
}
