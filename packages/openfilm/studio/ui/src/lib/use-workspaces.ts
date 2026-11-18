import React from 'react';
import { CURRENT_WORKSPACE_KEY, defaultWorkspace, normalizeLayout, readWorkspaceLayout, readWorkspaceProfiles, serializeProfiles, type ArrangementSpec, type WorkspaceLayout, type WorkspaceMode, type WorkspaceProfiles } from './workspaces';

/** An arrangement whose blocks are not known yet (its plugin not listed): the page's own blocks only. */
const unknown = (name: string): ArrangementSpec => ({ name, blocks: [] });

/**
 * The arrangements in use, kept in this browser: the one of `mode` and any other by its name (`layoutOf`), each as
 * kept with every block its workbench declares (`specs`, lib/blocks), and the way to change one.
 */
export function useWorkspaceLayouts(mode: WorkspaceMode, specs: ReadonlyMap<string, ArrangementSpec>) {
  const [profiles, setProfiles] = React.useState<WorkspaceProfiles>(() => readWorkspaceProfiles({ getItem: key => localStorage.getItem(key) }));
  const modeRef = React.useRef(mode); modeRef.current = mode;
  const specsRef = React.useRef(specs); specsRef.current = specs;
  const latest = React.useRef(profiles); latest.current = profiles;
  const [storageFailed, setStorageFailed] = React.useState(false);
  /* the arrangements shown with their blocks known: each is kept from then on, as it is drawn, though none changed it */
  const shown = React.useRef(new Set<string>());
  const layoutOfRef = React.useRef<(name: string) => WorkspaceLayout>(() => { throw new Error('not yet'); });
  const kept = () => {
    const out: Record<string, WorkspaceLayout> = { ...latest.current };
    for (const name of shown.current) out[name] ??= layoutOfRef.current(name);
    return serializeProfiles(out);
  };
  const save = () => { try { localStorage.setItem(CURRENT_WORKSPACE_KEY, kept()); setStorageFailed(false); } catch { setStorageFailed(true); } };
  React.useEffect(() => {
    const timer = window.setTimeout(save, 100);
    return () => window.clearTimeout(timer);
  }, [profiles]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const flush = () => { try { localStorage.setItem(CURRENT_WORKSPACE_KEY, kept()); } catch { /* The mounted effect reports storage failures. */ } };
    const changed = (event: StorageEvent) => {
      if (event.key !== CURRENT_WORKSPACE_KEY) return;
      const next = readWorkspaceProfiles({ getItem: key => localStorage.getItem(key) });
      setProfiles(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('storage', changed); flush(); };
  }, []);
  const update = React.useCallback((patch: Partial<WorkspaceLayout>) => {
    setProfiles(previous => {
      const target = patch.mode ?? modeRef.current;
      const spec = specsRef.current.get(target) ?? unknown(target);
      const now = normalizeLayout(previous[target] ?? defaultWorkspace(spec), spec);
      const read = readWorkspaceLayout({ ...now, ...patch, blocks: { ...now.blocks, ...patch.blocks }, mode: target });
      const next = read && normalizeLayout(read, spec);
      if (!next || JSON.stringify(next) === JSON.stringify(previous[target])) return previous;
      return { ...previous, [target]: next };
    });
  }, []);
  /* each arrangement as kept, with its blocks as declared: the same object while neither changes */
  const made = React.useRef(new Map<string, { kept: WorkspaceLayout | undefined; spec: ArrangementSpec; layout: WorkspaceLayout }>());
  const layoutOf = React.useCallback((name: string): WorkspaceLayout => {
    const spec = specs.get(name) ?? unknown(name), kept = profiles[name];
    const was = made.current.get(name);
    if (was && was.kept === kept && was.spec === spec) return was.layout;
    const layout = normalizeLayout(kept ?? defaultWorkspace(spec), spec);
    made.current.set(name, { kept, spec, layout });
    return layout;
  }, [profiles, specs]);
  const [viewport, setViewport] = React.useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  React.useEffect(() => { let frame = 0; const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setViewport({ width: window.innerWidth, height: window.innerHeight })); }; window.addEventListener('resize', resize); return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); }; }, []);
  layoutOfRef.current = layoutOf;
  /* the arrangement shown is kept from when it is first shown with its blocks known: written a moment after, nothing drawn again */
  const known = specs.has(mode);
  const saveRef = React.useRef(save); saveRef.current = save;
  React.useEffect(() => {
    if (!known || shown.current.has(mode)) return;
    shown.current.add(mode);
    if (!latest.current[mode]) window.setTimeout(() => saveRef.current(), 400);
  }, [known, mode]);
  return { layout: layoutOf(mode), layoutOf, update, viewport, storageFailed };
}

/** Layout editing is a transaction. Pointer previews never write preferences until Done. A patch's `blocks` are merged by key. */
export function useWorkspaceDraft() {
  type Edit = { value: WorkspaceLayout; past: WorkspaceLayout[]; future: WorkspaceLayout[] };
  const [edit,setEdit] = React.useState<Edit|null>(null);
  const active = React.useRef(false); active.current = edit !== null;
  const begin = React.useCallback((value: WorkspaceLayout) => setEdit({value:structuredClone(value),past:[],future:[]}),[]);
  const update = React.useCallback((patch: Partial<WorkspaceLayout>) => setEdit(previous => {
    if (!previous) return previous;
    const value = readWorkspaceLayout({...previous.value,...patch,blocks:{...previous.value.blocks,...patch.blocks},mode:previous.value.mode});
    return value && JSON.stringify(value)!==JSON.stringify(previous.value) ? {...previous,value} : previous;
  }),[]);
  const checkpoint = React.useCallback(() => setEdit(previous => !previous || JSON.stringify(previous.past.at(-1))===JSON.stringify(previous.value) ? previous : {...previous,past:[...previous.past,previous.value].slice(-40),future:[]}),[]);
  const change = React.useCallback((value: WorkspaceLayout) => setEdit(previous => !previous || JSON.stringify(value)===JSON.stringify(previous.value) ? previous : {value,past:[...previous.past,previous.value].slice(-40),future:[]}),[]);
  const undo = React.useCallback(() => setEdit(previous => !previous?.past.length ? previous : {value:previous.past.at(-1)!,past:previous.past.slice(0,-1),future:[previous.value,...previous.future]}),[]);
  const redo = React.useCallback(() => setEdit(previous => !previous?.future.length ? previous : {value:previous.future[0],past:[...previous.past,previous.value],future:previous.future.slice(1)}),[]);
  const close = React.useCallback(() => {active.current=false;setEdit(null);},[]);
  return { draft:edit?.value ?? null, active, begin, update, checkpoint, change, undo, redo, close, canUndo:!!edit?.past.length, canRedo:!!edit?.future.length };
}
