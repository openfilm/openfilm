import React from 'react';
import { GripVertical } from 'lucide-react';

/** Shared live reordering for Settings. Pointer moves preview the order; a drop or keyboard move commits it. */
export function ReorderList<T extends { id: string }>({ items, onChange, onCommit, label, dragLabel, children,
  disabled = false, fixedCount = 0, itemAttribute,
}: {
  items: readonly T[];
  onChange: (items: T[]) => void;
  onCommit?: (items: T[]) => void;
  label: string;
  dragLabel: (item: T) => string;
  children: (item: T, index: number) => React.ReactNode;
  disabled?: boolean;
  fixedCount?: number;
  itemAttribute?: 'data-model-id' | 'data-library-category';
}) {
  const list = React.useRef<HTMLOListElement>(null);
  const latest = React.useRef(items);
  latest.current = items;
  const drag = React.useRef<{ id: string; before: T[] } | null>(null);
  const positions = React.useRef<Map<string, number> | null>(null);
  const [dragged, setDragged] = React.useState<string | null>(null);

  React.useLayoutEffect(() => {
    const before = positions.current;
    positions.current = null;
    if (!before) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const row of list.current?.querySelectorAll<HTMLElement>('[data-reorder-id]') ?? []) {
      const top = before.get(row.dataset.reorderId!);
      for (const animation of row.getAnimations()) animation.cancel();
      const dy = top == null ? 0 : top - row.getBoundingClientRect().top;
      if (!reducedMotion && Math.abs(dy) > 1) row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
        { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }, [items]);

  const change = (next: T[]) => {
    positions.current = new Map([...list.current?.querySelectorAll<HTMLElement>('[data-reorder-id]') ?? []]
      .map((row) => [row.dataset.reorderId!, row.getBoundingClientRect().top]));
    latest.current = next;
    onChange(next);
  };
  const move = (id: string, to: number, commit = false) => {
    const from = latest.current.findIndex((item) => item.id === id);
    if (disabled || from < fixedCount || to < fixedCount || to >= latest.current.length || from === to) return;
    const next = [...latest.current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    change(next);
    if (commit) onCommit?.(next);
  };
  const finish = (dropped: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    setDragged(null);
    if (active.before.every((item, index) => item.id === latest.current[index]?.id)) return;
    if (dropped) onCommit?.([...latest.current]);
    else change(active.before);
  };

  return (
    <ol ref={list} aria-label={label} className="divide-y divide-[var(--border)]">
      {items.map((item, index) => {
        const fixed = index < fixedCount;
        return (
          <li key={item.id} data-reorder-id={item.id} {...(itemAttribute ? { [itemAttribute]: item.id } : {})}
            className={`flex items-center gap-3 py-3 ${dragged === item.id ? 'opacity-40' : ''}`}
            onDragOver={(e) => {
              const active = drag.current;
              if (!active || disabled || fixed) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              const from = latest.current.findIndex((row) => row.id === active.id);
              const bounds = e.currentTarget.getBoundingClientRect();
              const middle = bounds.top + bounds.height / 2;
              if (from < index && e.clientY < middle || from > index && e.clientY > middle) return;
              move(active.id, index);
            }}
            onDrop={(e) => {
              if (!drag.current || fixed) return;
              e.preventDefault();
              e.stopPropagation();
              finish(true);
            }}>
            <button type="button" disabled={disabled || fixed} draggable={!disabled && !fixed} aria-label={dragLabel(item)}
              className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-[var(--text-faint)] outline-none active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-[var(--border-strong)] disabled:cursor-default disabled:opacity-30"
              onDragStart={(e) => {
                drag.current = { id: item.id, before: [...latest.current] };
                setDragged(item.id);
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.id);
                const row = e.currentTarget.closest('li');
                if (row) {
                  const bounds = row.getBoundingClientRect();
                  e.dataTransfer.setDragImage(row, e.clientX - bounds.left, e.clientY - bounds.top);
                }
              }}
              onDragEnd={() => finish(false)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                e.preventDefault();
                e.stopPropagation();
                move(item.id, index + (e.key === 'ArrowUp' ? -1 : 1), true);
              }}><GripVertical size={15} /></button>
            {children(item, index)}
          </li>
        );
      })}
    </ol>
  );
}
