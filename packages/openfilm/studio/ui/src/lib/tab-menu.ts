/** The tabs a tab's menu closes (TabStrip): the others, or those to its right; none when the tab is not there. */
export function tabsToClose<T extends { id: string }>(tabs: readonly T[], id: string, which: 'others' | 'right'): T[] {
  const i = tabs.findIndex((tab) => tab.id === id);
  if (i < 0) return [];
  return which === 'others' ? tabs.filter((tab) => tab.id !== id) : tabs.slice(i + 1);
}
