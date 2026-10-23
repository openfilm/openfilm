import React from 'react';
import { Waves, TriangleAlert } from 'lucide-react';
import { useT } from '@/i18n';
import { ContextMenu } from './ContextMenu';
import { Tooltip } from './Tooltip';

/** Project-wide policy, enforced by the edit API. Outside file writes are checked, never silently rewritten. */
export function AudioSmoothingControl({ ms, pending, busy, onChange, onRepair }: {
  ms: number; pending: number; busy: boolean; onChange: (ms: number | null) => void; onRepair: () => void;
}) {
  const t = useT();
  const [at, setAt] = React.useState<{ x: number; y: number } | null>(null);
  const duration = (n: number) => t('timeline.audioCutFadeDuration').replace('{ms}', String(n));
  const label = `${t('timeline.autoAudioSmoothing')}: ${ms ? duration(ms) : t('timeline.autoAudioOff')}`;
  return <>
    <Tooltip label={label}>
      <button type="button" disabled={busy} aria-label={label} aria-pressed={ms > 0}
        className="flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-40"
        style={{ color: ms ? 'var(--tl-accent)' : 'var(--text-dim)' }}
        onClick={(e) => { const box = e.currentTarget.getBoundingClientRect(); setAt({ x: box.left, y: box.bottom }); }}>
        <Waves size={15} />{ms ? duration(ms) : null}
      </button>
    </Tooltip>
    {ms > 0 && pending > 0 ? <button type="button" disabled={busy} onClick={onRepair}
      className="flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-[var(--err)] hover:bg-[var(--bg-hover)]"
      title={t('timeline.autoAudioExternalHint')}>
      <TriangleAlert size={14} />{t('timeline.autoAudioPending').replace('{n}', String(pending))}
    </button> : null}
    {at ? <ContextMenu x={at.x} y={at.y} onClose={() => setAt(null)} items={[
      { id: 'audio-auto-off', label: t('timeline.autoAudioOff'), checked: !ms, onSelect: () => onChange(null) },
      ...[5, 10, 20].map((n) => ({ id: `audio-auto-${n}`, label: duration(n), checked: ms === n,
        note: n === 10 ? t('timeline.autoAudioHint') : undefined, onSelect: () => onChange(n) })),
    ]} /> : null}
  </>;
}
