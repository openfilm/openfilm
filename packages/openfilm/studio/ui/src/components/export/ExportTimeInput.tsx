import React from 'react';
import { ChevronDown } from 'lucide-react';
import { ContextMenu } from '@/components/ContextMenu';
import { formatTimecode } from '@/lib/timecode';
import { parseExportTime } from '@/lib/export-range';

/** A typed position with the existing clip boundaries available from its arrow. */
export function ExportTimeInput({ label, boundaryLabel, value, fps, marks, invalid, onChange, compact = false }: {
  label: string;
  boundaryLabel: string;
  value: string;
  fps: number;
  marks: readonly { ms: number; title: string }[];
  invalid: boolean;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const [menu, setMenu] = React.useState<{ x: number; y: number; top: number } | null>(null);
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const inputId = React.useId();
  const current = parseExportTime(value, fps);
  return (
    <div className={`flex max-w-full flex-col gap-1.5 ${compact ? 'w-full' : 'w-[220px]'}`}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-[11.5px] text-[var(--text-faint)]">{label}</label>
        <span className={`flex h-9 items-center overflow-hidden rounded-lg border bg-[var(--fill-tsp)] focus-within:border-[var(--accent)] ${invalid ? 'border-[var(--warn)]' : 'border-[var(--border)]'}`}>
          <input
            id={inputId}
            type="text"
            aria-label={label}
            aria-invalid={invalid}
            value={value}
            placeholder="00:00.000"
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="h-full min-w-0 flex-1 bg-transparent pl-3 font-mono text-[13px] tabular-nums text-[var(--text)] outline-none"
          />
          <button
            ref={trigger}
            type="button"
            aria-label={`${label} · ${boundaryLabel}`}
            title={boundaryLabel}
            aria-haspopup="menu"
            aria-expanded={Boolean(menu)}
            onClick={(e) => {
              if (menu) { setMenu(null); return; }
              const rect = e.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.right, y: rect.bottom + 4, top: rect.top - 4 });
            }}
            className="flex h-full w-8 shrink-0 items-center justify-center text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <ChevronDown size={13} />
          </button>
        </span>
      </div>
      {menu && <ContextMenu
        x={menu.x}
        y={menu.y}
        flipTo={menu.top}
        align="end"
        dense
        trigger={trigger}
        items={marks.map((mark) => ({
          id: String(mark.ms),
          label: [formatTimecode(mark.ms, { fps }), mark.title].filter(Boolean).join(' · '),
          checked: current != null && Math.abs(current - mark.ms) < 0.001,
          onSelect: () => onChange(String(mark.ms / 1000)),
        }))}
        onClose={() => setMenu(null)}
      />}
    </div>
  );
}

