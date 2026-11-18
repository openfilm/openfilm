import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronRight, Folder, LibraryBig, X } from 'lucide-react';
import { useT } from '@/i18n';
import styles from './ProjectsView.module.css';

/** A folder chooser browses one level at a time, even when the library contains thousands of folders. */
export function ResourceDestinationDialog({ mode, folders, onBrowse, onChoose, onClose }: {
  mode: 'copy' | 'link'; folders: string[]; onBrowse?: (path: string) => Promise<string[]>; onChoose: (path: string) => void; onClose: () => void;
}) {
  const t = useT();
  const [at, setAt] = React.useState('');
  const [available, setAvailable] = React.useState(folders);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { if (!onBrowse) return; let live = true; setLoading(true); setError(''); void onBrowse(at).then(paths => { if (live) setAvailable(paths); }, error => { if (live) setError(error instanceof Error ? error.message : t('assetLibrary.failed')); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [at, onBrowse]);
  const [limit, setLimit] = React.useState(160);
  const root = React.useRef<HTMLDivElement>(null);
  const close = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { setLimit(160); }, [at]);
  React.useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, []);
  const children = available.filter(path => path.split('/').slice(0, -1).join('/') === at).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const crumbs = at ? at.split('/') : [];
  return createPortal(<div className={styles.namingOverlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label={t(mode === 'copy' ? 'resourceCenter.copyTo' : 'resourceCenter.linkTo')} className={`${styles.namingDialog} ${styles.destinationDialog}`} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div><strong>{t(mode === 'copy' ? 'resourceCenter.copyTo' : 'resourceCenter.linkTo')}</strong><button type="button" ref={close} className={styles.iconButton} aria-label={t('project.close')} onClick={onClose}><X size={16} /></button></div>
      <nav className={styles.destinationPath} aria-label={t('resourceCenter.destination')}>
        <button type="button" className={styles.iconButton} disabled={!at} aria-label={t('projects.folderUp')} onClick={() => setAt(at.split('/').slice(0, -1).join('/'))}><ArrowUp size={14} /></button>
        <button type="button" onClick={() => setAt('')}><LibraryBig size={15} strokeWidth={1.75} />{t('saved.title')}</button>
        {crumbs.map((name, index) => <React.Fragment key={index}><ChevronRight size={11} /><button type="button" onClick={() => setAt(crumbs.slice(0, index + 1).join('/'))}>{name}</button></React.Fragment>)}
      </nav>
      <div className={styles.destinationFolders}>
        {children.slice(0, limit).map(path => <button type="button" key={path} onClick={() => setAt(path)}><Folder size={17} /><span>{path.split('/').at(-1)}</span><ChevronRight size={12} /></button>)}
        {error ? <p role="alert">{error}</p> : !children.length ? <p>{loading ? t('projects.opening') : t('media.emptyFolder')}</p> : null}
        {children.length > limit ? <button type="button" onClick={() => setLimit(value => value + 160)}>{t('assetLibrary.loadMore')}</button> : null}
      </div>
      <div className={styles.destinationActions}><button type="button" className={styles.action} onClick={onClose}>{t('confirm.cancel')}</button><button type="button" className={`${styles.action} ${styles.primary}`} disabled={loading || Boolean(error)} onClick={() => onChoose(at)}>{t(mode === 'copy' ? 'resourceCenter.copyHere' : 'resourceCenter.linkHere')}</button></div>
    </div>
  </div>, document.body);
}
