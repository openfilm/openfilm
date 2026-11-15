import React from 'react';
import { ChevronDown, LayoutGrid, List } from 'lucide-react';
import { useT } from '@/i18n';
import type { ResourceView } from '@/lib/resource-center';
import { ContextMenu } from './ContextMenu';
import styles from './ProjectsView.module.css';

export function FileViewControl({ value, onChange }: { value: ResourceView; onChange: (value: ResourceView) => void }) {
  const t = useT();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  return <>
    <button type="button" ref={trigger} className={styles.action} aria-label={t('resourceCenter.view')} aria-haspopup="menu" aria-expanded={Boolean(menu)} data-resource-view={value}
      onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: box.right - 174, y: box.bottom + 5 }); }}>
      {value === 'list' ? <List size={15} /> : <LayoutGrid size={15} />}<span>{t(`resourceCenter.view_${value}`)}</span><ChevronDown size={12} />
    </button>
    {menu ? <ContextMenu x={menu.x} y={menu.y} trigger={trigger} onClose={() => setMenu(null)} items={(['large', 'medium', 'small', 'list'] as const).map(mode => ({ id: mode, label: t(`resourceCenter.view_${mode}`), checked: value === mode, onSelect: () => onChange(mode) }))} /> : null}
  </>;
}
