/** One workspace control for the edit and canvas: presets, independent docks and portable named layouts. */
import React from 'react';
import { Check, Download, GripVertical, MoreHorizontal, PanelsRightBottom, Pencil, Plus, RotateCcw, Save, Trash2, Upload, X } from 'lucide-react';
import { useT } from '@/i18n';
import { LEGACY_WORKSPACES_KEY, MAX_WORKSPACES, WORKSPACES_KEY, keepWorkspace, parseWorkspaces, sameWorkspace, serializeWorkspaces, workspacePresets, type SavedWorkspace, type WorkspaceLayout } from '@/lib/workspaces';
import { WorkspacePreview } from './WorkspacePreview';
import { Popover } from './Popover';
import styles from './ProjectLayoutMenu.module.css';

export function ProjectLayoutMenu({ className, value, onChange, onReset, hasChat, onEdit, layoutEditing, storageFailed, viewport, timelineFitHeight, inspectorIdle }: {
  className?: string; value: WorkspaceLayout; onChange: (layout: WorkspaceLayout) => void; onReset: () => void;
  viewport: {width:number;height:number}; timelineFitHeight:number; inspectorIdle:boolean;
  hasChat: boolean; onEdit: () => void; layoutEditing?: boolean; storageFailed?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { if (layoutEditing) setOpen(false); }, [layoutEditing]);
  const [saved, setSaved] = React.useState<SavedWorkspace[]>([]);
  const [editing, setEditing] = React.useState<{ id: string | null; name: string } | null>(null);
  const [actions, setActions] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState('');
  const [removed, setRemoved] = React.useState<SavedWorkspace | null>(null);
  const input = React.useRef<HTMLInputElement>(null), importInput = React.useRef<HTMLInputElement>(null);
  const button = React.useRef<HTMLButtonElement>(null), panel = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  React.useEffect(() => {
    if (!open) return;
    try { setSaved(parseWorkspaces(localStorage.getItem(WORKSPACES_KEY) ?? localStorage.getItem(LEGACY_WORKSPACES_KEY))); } catch { setSaved([]); }
    setEditing(null); setActions(null); setNotice(''); setRemoved(null);
  }, [open]);
  React.useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [Boolean(editing)]);
  const show = (next: boolean) => { setOpen(next); if (!next && panel.current?.contains(document.activeElement)) button.current?.focus(); };
  const keep = (rows: SavedWorkspace[]) => { setSaved(rows); setNotice(''); try { localStorage.setItem(WORKSPACES_KEY, serializeWorkspaces(rows)); } catch { setNotice(t('layout.storageFailed')); } };
  const name = editing?.name.replace(/\s+/g,' ').trim().slice(0,40) ?? '';
  const duplicate = !!name && saved.some(row => row.id !== editing?.id && row.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const begin = (row?: SavedWorkspace) => { setActions(null); setEditing({ id: row?.id ?? null, name: row?.name ?? t('layout.untitled').replace('{n}',String(saved.length+1)) }); };
  const save = () => {
    if (!editing || !name || duplicate) return;
    const previous = saved.find(row => row.id === editing.id);
    const rows = keepWorkspace(saved, { id: previous?.id ?? crypto.randomUUID(), name, layout: previous?.layout ?? { ...value } });
    if (rows) { keep(rows); setEditing(null); }
  };
  const exportLayouts = () => {
    const rows = saved.length ? saved : [{ id: crypto.randomUUID(), name: t('layout.untitled').replace('{n}','1'), layout: value }];
    const url = URL.createObjectURL(new Blob([serializeWorkspaces(rows)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'openfilm-layouts.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  const importLayouts = async (file?: File) => {
    if (!file) return;
    if (file.size > 256*1024) { setNotice(t('layout.importFailed')); return; }
    try {
      const imported = parseWorkspaces(await file.text()); if (!imported.length) throw new Error();
      let rows = [...saved], added = 0;
      for (const row of imported) {
        if (rows.some(item => item.name === row.name && sameWorkspace(item.layout,row.layout,true))) continue;
        let name = row.name, suffix = 2;
        while (rows.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${row.name.slice(0,34)} (${suffix++})`;
        const next = keepWorkspace(rows, { ...row, id: crypto.randomUUID(), name });
        if (next) { rows = next; added++; }
      }
      keep(rows); setNotice(t(added ? 'layout.imported' : 'layout.importLimit').replace('{n}',String(added)));
    } catch { setNotice(t('layout.importFailed')); }
    finally { if (importInput.current) importInput.current.value = ''; }
  };
  return <Popover open={open} onOpenChange={show} align="end" layer={10060}
    onEscapeKeyDown={event => { event.stopPropagation(); if (editing) setEditing(null); else if (actions) setActions(null); else show(false); }}
    trigger={<button ref={button} data-layout-trigger type="button" disabled={layoutEditing} className={className} aria-label={t('layout.title')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined}><PanelsRightBottom size={16}/></button>}>
    <div ref={panel} id={id} data-layout-menu role="dialog" tabIndex={-1} aria-label={t('layout.title')} className={styles.menu}>
      <div className={styles.heading}><strong>{t('layout.title')}</strong><button type="button" className={styles.reset} onClick={onReset}><RotateCcw size={12}/>{t('layout.restoreDefault')}</button></div>
      <p className={styles.modeLabel}>{t(value.mode==='edit'?'layout.editLayouts':'layout.canvasLayouts')}</p>
      <div className={styles.presets}>{workspacePresets(value.mode).map(preset=><button key={preset.id} type="button" aria-label={t(`layout.preset_${preset.id}`)} aria-pressed={sameWorkspace(value,preset.layout,hasChat)} onClick={()=>onChange(preset.layout)}><WorkspacePreview layout={preset.layout} viewport={viewport} hasChat={hasChat} timelineFitHeight={timelineFitHeight} inspectorIdle={inspectorIdle} className={styles.preview}/><span>{t(`layout.preset_${preset.id}`)}</span></button>)}</div>
      <button type="button" className={styles.editLayout} onClick={()=>{show(false);onEdit();}}><GripVertical size={15}/><span>{t('layout.editLayout')}</span><Pencil size={13}/></button>
      <section className={styles.section}><div className={styles.customHeading}><h3>{t('layout.savedLayouts')}</h3><span>{saved.length}/{MAX_WORKSPACES}</span><button type="button" disabled={saved.length>=MAX_WORKSPACES} aria-label={t('layout.saveCurrentShort')} onClick={()=>begin()}><Plus size={14}/>{t('layout.saveCurrentShort')}</button></div>
        {editing?<form className={styles.nameForm} onSubmit={event=>{event.preventDefault();save();}}><input ref={input} aria-label={t('layout.name')} value={editing.name} maxLength={40} onChange={event=>setEditing({...editing,name:event.target.value})}/><button type="button" className={styles.iconButton} aria-label={t('layout.cancel')} onClick={()=>setEditing(null)}><X size={13}/></button><button type="submit" className={styles.done} disabled={!name||duplicate}>{t('layout.save')}</button></form>:null}
        {saved.filter(row=>row.layout.mode===value.mode).map(row=><div key={row.id} className={styles.slot}><div className={styles.slotRow}><button type="button" className={styles.savedName} aria-pressed={sameWorkspace(value,row.layout,hasChat)} onClick={()=>{onChange(row.layout);setActions(null);}}><span>{row.name}</span>{sameWorkspace(value,row.layout,hasChat)?<Check size={13}/>:null}</button><button type="button" className={styles.iconButton} aria-label={t('layout.moreNamed').replace('{name}',row.name)} aria-expanded={actions===row.id} onClick={()=>setActions(actions===row.id?null:row.id)}><MoreHorizontal size={15}/></button></div>{actions===row.id?<div className={styles.actions}><button type="button" onClick={()=>begin(row)}><Pencil size={12}/>{t('layout.rename')}</button><button type="button" onClick={()=>{const next=keepWorkspace(saved,{...row,layout:value});if(next)keep(next);setActions(null);}}><Save size={12}/>{t('layout.update')}</button><button type="button" onClick={()=>{setRemoved(row);keep(saved.filter(r=>r.id!==row.id));setActions(null);}}><Trash2 size={12}/>{t('layout.removeShort')}</button></div>:null}</div>)}
        {!saved.some(row=>row.layout.mode===value.mode)&&!editing?<p className={styles.hint}>{t('layout.noSaved')}</p>:null}
        {removed?<button type="button" className={styles.reset} onClick={()=>{const next=keepWorkspace(saved,removed);if(next){keep(next);setRemoved(null);}else setNotice(t('layout.nameTaken'));}}><RotateCcw size={12}/>{t('layout.undoDelete')}</button>:null}
        <div className={styles.portable}><button type="button" onClick={()=>importInput.current?.click()}><Upload size={13}/>{t('layout.import')}</button><button type="button" onClick={exportLayouts}><Download size={13}/>{t('layout.export')}</button><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={event=>void importLayouts(event.target.files?.[0])}/></div>
      </section>
      {duplicate?<p role="alert" className={styles.notice}>{t('layout.nameTaken')}</p>:null}
      {notice||storageFailed?<p role="status" className={styles.notice}>{notice||t('layout.storageFailed')}</p>:null}
    </div>
  </Popover>;
}
