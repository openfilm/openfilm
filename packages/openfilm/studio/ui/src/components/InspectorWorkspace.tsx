import * as React from 'react';
import { Lock } from 'lucide-react';
import { useT } from '@/i18n';
import {
  inspectorActiveTab, inspectorTabForSection, inspectorTabs,
  type InspectorKind, type InspectorTab,
} from '@/lib/inspector-sections';
import styles from './InspectorWorkspace.module.css';

type WorkspaceContext = {
  active: InspectorTab;
  register: (id: string) => void;
  remove: (id: string) => void;
};

export const InspectorReadOnly = React.createContext(false);
export const InspectorWorkspaceContext = React.createContext<WorkspaceContext | null>(null);

/** Navigation remains available on locked tracks; only controls that change the object are disabled. */
export function InspectorEditable({ children }: { children: React.ReactNode }) {
  const locked = React.useContext(InspectorReadOnly);
  return <fieldset disabled={locked} className="contents">{children}</fieldset>;
}

export function InspectorCategory({ tab, children }: { tab: InspectorTab; children: React.ReactNode }) {
  const workspace = React.useContext(InspectorWorkspaceContext);
  return <div hidden={Boolean(workspace && workspace.active !== tab)}>{children}</div>;
}

const rememberedTabs = new Map<InspectorKind, InspectorTab>();
const sectionRequests = new Set<(id: string) => void>();
let pendingSection: string | null = null;

/** A mask command on the picture must reveal its category as well as unfold its controls. */
export function requestInspectorSection(id: string): void {
  pendingSection = id;
  for (const show of sectionRequests) show(id);
}

/** Categories sit directly above the selected object's property controls. */
export function InspectorWorkspace({ kind, children, label }: {
  kind: InspectorKind;
  children: React.ReactNode;
  label?: string;
}) {
  const t = useT();
  const locked = React.useContext(InspectorReadOnly);
  const [preferred, setPreferred] = React.useState<InspectorTab>(() => rememberedTabs.get(kind) ?? (kind === 'text' ? 'text' : 'properties'));
  const [sections, setSections] = React.useState<ReadonlySet<string>>(() => new Set());
  const scroll = React.useRef<HTMLDivElement>(null);
  const nav = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const register = React.useCallback((key: string) => {
    setSections((before) => before.has(key) ? before : new Set(before).add(key));
  }, []);
  const remove = React.useCallback((key: string) => {
    setSections((before) => {
      if (!before.has(key)) return before;
      const next = new Set(before);
      next.delete(key);
      return next;
    });
  }, []);
  const tabs = inspectorTabs([...sections]);
  const active = inspectorActiveTab(preferred, tabs);
  const choose = (tab: InspectorTab) => {
    setPreferred(tab);
    rememberedTabs.set(kind, tab);
    scroll.current?.scrollTo({ top: 0 });
  };
  React.useEffect(() => {
    const reveal = (section: string) => {
      if (!sections.has(section)) return;
      pendingSection = null;
      const category = inspectorTabForSection(section);
      setPreferred(category);
      rememberedTabs.set(kind, category);
      requestAnimationFrame(() => {
        [...(scroll.current?.querySelectorAll<HTMLElement>('[data-section]') ?? [])]
          .find((element) => element.dataset.section === section)?.scrollIntoView({ block: 'nearest' });
      });
    };
    sectionRequests.add(reveal);
    if (pendingSection) reveal(pendingSection);
    return () => { sectionRequests.delete(reveal); };
  }, [sections, kind]);
  const context = React.useMemo(() => ({ active, register, remove }), [active, register, remove]);

  return (
    <InspectorWorkspaceContext.Provider value={context}>
      <div className={styles.workspace} data-inspector-workspace role={label ? 'region' : undefined} aria-label={label}>
        <div className={styles.tabs} ref={nav} role="tablist" aria-label={t('inspector.workspace.categories')} onKeyDown={(event) => {
          if (!tabs.length) return;
          const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (!delta && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          event.stopPropagation();
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(active) + delta + tabs.length) % tabs.length;
          choose(tabs[index]!);
          nav.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
        }}>
          {tabs.map((tab) => (
            <button key={tab} type="button" role="tab" id={`${id}-${tab}`} aria-controls={`${id}-content`}
              aria-selected={active === tab} tabIndex={active === tab ? 0 : -1}
              className={active === tab ? styles.selectedTab : ''} onClick={() => choose(tab)}>
              {t(`inspector.workspace.tabs.${tab}`)}
            </button>
          ))}
        </div>
        {locked ? <div role="status" data-inspector-locked className={styles.locked}><Lock size={12} aria-hidden />{t('inspector.trackLocked')}</div> : null}
        <div className={styles.scroll} ref={scroll} id={`${id}-content`}
          role={tabs.length ? 'tabpanel' : undefined}
          aria-labelledby={tabs.length ? `${id}-${active}` : undefined}>
          {children}
        </div>
      </div>
    </InspectorWorkspaceContext.Provider>
  );
}

