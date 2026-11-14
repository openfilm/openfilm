import React from 'react';
import { useT } from '@/i18n';
import { arrangedCategories, FIRST_CATEGORY } from '@/lib/library-categories';
import { CATEGORIES } from '../library/LibraryDrawer';
import { keepArrangement, useLibraryArrangement } from '../library/arrangement';
import { CategoryMark, useCategoryName, usePluginTabs, withTabs } from '../library/plugin-tabs';
import { ReorderList } from './ReorderList';
import { SettingsGroup, SettingsSwitch } from './ui';

/** The same live drag controls as the agent models. Media stays first and shown. The tabs of the plugins on are among them. */
export function LibraryCategoriesGroup() {
  const t = useT();
  const arranged = useLibraryArrangement();
  const tabs = usePluginTabs(null);
  const name = useCategoryName(tabs);
  const [list, setList] = React.useState<{ id: string; on: boolean }[] | null>(null);
  const now = list ?? arrangedCategories(withTabs(CATEGORIES, tabs), arranged);
  const pending = React.useRef(Promise.resolve());
  const revision = React.useRef(0);
  const keep = (next: { id: string; on: boolean }[]) => {
    const attempt = ++revision.current;
    setList(next);
    // A drag commits once, after its preview; successive changes reach prefs in the same order as the gestures.
    pending.current = pending.current.then(async () => { await keepArrangement(next); }).catch(() => {
      if (attempt === revision.current) setList(null);
    });
  };
  return (
    <SettingsGroup title={t('settings.libraryCategories.group')} footnote={t('settings.libraryCategories.hint')}>
      <ReorderList items={now} onChange={setList} onCommit={keep} fixedCount={1}
        label={t('settings.libraryCategories.group')} itemAttribute="data-library-category"
        dragLabel={(item) => t('settings.libraryCategories.drag').replace('{name}', name(item.id))}>
        {(category) => (
          <>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--bg-field)] text-[var(--text)]"><CategoryMark id={category.id} tabs={tabs} on={false} size={16} /></span>
            <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--text)]">{name(category.id)}</span>
            <SettingsSwitch checked={category.on} disabled={category.id === FIRST_CATEGORY} label={name(category.id)}
              onChange={(on) => keep(now.map((item) => item.id === category.id ? { ...item, on } : item))} />
          </>
        )}
      </ReorderList>
    </SettingsGroup>
  );
}
