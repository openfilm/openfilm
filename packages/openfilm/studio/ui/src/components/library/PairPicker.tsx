/**
 * Two of a service's voices made a pair that speaks a dialogue (VoicesPane's "Choose two voices"): the first speaks
 * first. Then the dialogue is written as with a ready-made pair (SpeakDialog).
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { languageOf, voicePair, type LibraryVoice } from '@/lib/library-voices';
import { Card, CardActions, CardButton } from '../Card';
import { MenuSelect } from '../MenuSelect';

export function PairPicker({ voices, languageName, onPick, onClose }: {
  voices: LibraryVoice[];
  languageName: (code: string) => string;
  onPick: (pair: LibraryVoice) => void;
  onClose: () => void;
}) {
  const t = useT();
  /* by language, the one most of them speak first */
  const groups = React.useMemo(() => {
    const by = new Map<string, LibraryVoice[]>();
    for (const v of voices) { const l = languageOf(v) ?? ''; by.set(l, [...(by.get(l) ?? []), v]); }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([l, list]) => ({ label: languageName(l) || '—', choices: list.map((v) => ({ value: v.id, label: v.description ? `${v.name} · ${v.description}` : v.name })) }));
  }, [voices, languageName]);
  const [first, setFirst] = React.useState(voices[0]?.id ?? '');
  const [second, setSecond] = React.useState(voices.find((v) => v.id !== voices[0]?.id && v.gender !== voices[0]?.gender)?.id ?? voices[1]?.id ?? '');
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-popover-panel]')) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const a = voices.find((v) => v.id === first);
  const b = voices.find((v) => v.id === second);
  return createPortal(
    <div className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('assetDrawer.pairChoose')} data-pair-picker="" className="w-full max-w-[420px]" onClick={(e) => e.stopPropagation()}>
        <Card title={t('assetDrawer.pairChoose')} body={t('assetDrawer.pairChooseNote')} onClose={onClose}>
          <div className="mt-3 flex flex-col gap-3">
            {([[t('assetDrawer.pairFirst'), first, setFirst], [t('assetDrawer.pairSecond'), second, setSecond]] as const).map(([label, value, set]) => (
              <label key={label} className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">{label}
                <MenuSelect label={label} value={value} onPick={set} size="md" layer={10120} groups={groups} />
              </label>
            ))}
          </div>
          <CardActions>
            <CardButton weight="quiet" onClick={onClose}>{t('confirm.cancel')}</CardButton>
            <CardButton weight="primary" disabled={!a || !b || a.id === b.id} onClick={() => { if (a && b && a.id !== b.id) onPick(voicePair(a, b)); }}>{t('assetDrawer.pairWrite')}</CardButton>
          </CardActions>
        </Card>
      </div>
    </div>,
    document.body,
  );
}
