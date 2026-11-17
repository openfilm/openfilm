/**
 * Settings → General → Storage: a row above About (StorageEntry, what OpenFilm takes and what is free) opens its page
 * (StorageGroup): the projects library, the folder
 * every project is a folder of (studio/server's locations, src/locations.mjs). It shows its folder and the free space
 * on its disk, and can be changed (the system's folder dialog), opened in the file manager, or set back to its default.
 * When projects are in it, a change asks whether they move too; left behind, they stay where they are, and in the list.
 * Exports have no setting: the export dialog picks the folder and keeps the last one.
 *
 * Above it, what OpenFilm takes, as the system's storage page draws a disk: the whole, a bar of it by OpenFilm's areas,
 * and the free space beside it (studio/server/storage.mjs). Under it the same areas as rows, apart so they add up to
 * the whole: its projects and those linked from elsewhere (each project a click away), the library, the person's
 * skills, the exports, the cache (with the button that clears it) and what OpenFilm keeps for itself. It opens at once
 * and fills in when the folders are measured (the server keeps that a moment).
 */
import React from 'react';
import { ChevronRight, HardDrive } from 'lucide-react';
import { useT } from '@/i18n';
import { api, type ProjectUsage, type StorageUsage, type StudioLocation, type StudioLocations } from '@/api';
import { studioHost } from '@/lib/host';
import { ConfirmDialog } from '../ConfirmDialog';
import { SettingsButton, SettingsField, SettingsGroup, SettingsItem, settingsError } from './ui';

type Which = keyof StudioLocations;

/** Bytes as the person reads a disk's free space: GB, or MB below one. */
export function size(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** Bytes a folder takes, down to nothing: GB, MB, or 0. */
function amount(bytes: number): string {
  return bytes < 5e5 ? '0 MB' : size(bytes);
}

/* OpenFilm's areas, as the sidebar has them (its projects, those linked from elsewhere, the library, the person's
   skills) and the rest it keeps (exports, the cache, its own): the bar draws them and the list under it names them,
   each in its color. Apart from one another (a project's cache is counted in the cache), so they add up to the whole */
const KINDS = [
  { key: 'projects', color: '#ff5f57' },
  { key: 'linked', color: '#ff9f0a' },
  { key: 'saved', color: '#30d158' },
  { key: 'skills', color: '#bf5af2' },
  { key: 'exports', color: '#0a84ff' },
  { key: 'cache', color: '#64d2ff' },
  { key: 'app', color: '#8e8e93' },
] as const;
type Kind = (typeof KINDS)[number]['key'];
/** Under this a kind is too small to draw or list (it reads as 0 MB). */
const SHOWN = 5e5;

/** What each area takes. */
function byKind(u: StorageUsage): Record<Kind, number> {
  const sum = (list: ProjectUsage[]) => list.reduce((n, p) => n + Math.max(0, p.total - (p.cache ?? 0)), 0);
  return {
    projects: sum(u.projects.filter((p) => !p.linked)),
    linked: sum(u.projects.filter((p) => p.linked)),
    saved: u.places?.saved ?? 0,
    skills: u.places?.skills ?? 0,
    exports: u.places?.exports ?? 0,
    cache: u.projects.reduce((n, p) => n + (p.cache ?? 0), 0),
    app: u.places?.app ?? 0,
  };
}

/**
 * What OpenFilm takes, as the system's storage page draws a disk: its whole at the top, a bar of it in its kinds, and
 * beside it how much is still free on the disk (its own size and what else is on it are the system's to say).
 */
function Overview({ kinds, free }: { kinds: Record<Kind, number> | null; free: number | null }) {
  const t = useT();
  const total = kinds ? Object.values(kinds).reduce((a, b) => a + b, 0) : 0;
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div data-storage-overview="" className="rounded-[12px] bg-[var(--bg-field)] px-5 py-4">
      <div className="flex items-baseline gap-3">
        <span className="text-[14px] text-[var(--text-muted)]">{t('settings.storage.ours')}</span>
        <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--text)]">{kinds ? amount(total) : '…'}</span>
        {free != null ? <span className="ml-auto text-[13px] tabular-nums text-[var(--text-faint)]">{t('settings.storage.free').replace('{size}', size(free))}</span> : null}
      </div>
      <div className="mt-3 flex h-[18px] gap-[2px] overflow-hidden rounded-[5px] bg-[var(--bg-panel)]" role="img"
        aria-label={kinds ? KINDS.filter((k) => kinds[k.key] >= SHOWN).map((k) => `${t(`settings.storage.area.${k.key}`)} ${amount(kinds[k.key])}`).join(', ') : t('settings.storage.usageLoading')}>
        {kinds ? KINDS.map((k) => kinds[k.key] >= SHOWN ? <span key={k.key} title={`${t(`settings.storage.area.${k.key}`)} · ${amount(kinds[k.key])}`}
          className="h-full" style={{ width: pct(kinds[k.key]), minWidth: 3, background: k.color }} /> : null)
          : <span className="h-full w-full animate-pulse bg-[#3a3a3c] motion-reduce:animate-none" />}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-muted)]">
        {KINDS.filter((k) => !kinds || kinds[k.key] >= SHOWN).map((k) => (
          <span key={k.key} className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: k.color }} />{t(`settings.storage.area.${k.key}`)}</span>
        ))}
      </div>
    </div>
  );
}

/** A kind's mark in a row: a square in its bar color. */
const Swatch = ({ color }: { color: string }) => <span className="h-3 w-3 rounded-[3px]" style={{ background: color }} />;


/** A row of the list: its mark, name and what it says, its size, and what it holds a click away (`children`). */
function StorageRow({ icon, name, note, bytes, action, children }: {
  icon: React.ReactNode; name: string; note?: string; bytes: number | null; action?: React.ReactNode; children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const opens = Boolean(children);
  const head = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-field)] text-[var(--text-muted)]">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14px] text-[var(--text)]">{name}</span>
        {note ? <span className="block truncate text-[12px] text-[var(--text-faint)]">{note}</span> : null}
      </span>
      <span className="shrink-0 text-[13.5px] tabular-nums text-[var(--text-muted)]">{bytes == null ? '…' : amount(bytes)}</span>
      {opens ? <ChevronRight size={15} aria-hidden className={`shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-90' : ''}`} /> : <span className="w-[15px] shrink-0" />}
    </>
  );
  return (
    <div className="py-1">
      <div className="flex items-center gap-3">
        {opens ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen((on) => !on)} className="flex min-w-0 flex-1 items-center gap-3 rounded-[8px] py-1.5 hover:bg-[var(--bg-hover)]">{head}</button>
        ) : <div className="flex min-w-0 flex-1 items-center gap-3 py-1.5">{head}</div>}
        {action}
      </div>
      {open && children ? <div className="pb-1 pl-11 pr-6">{children}</div> : null}
    </div>
  );
}

/** Projects as a list under their row: each one's name, its size, its cache; where it is, to the pointer. */
function ProjectList({ projects }: { projects: ProjectUsage[] }) {
  const t = useT();
  return (
    <ul data-storage-projects="" className="max-h-[220px] overflow-y-auto">
      {projects.map((p) => (
        <li key={p.id} className="flex items-baseline gap-3 py-0.5 text-[13px] text-[var(--text-muted)]" title={p.path}>
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <span className="shrink-0 tabular-nums" title={t('settings.storage.parts').replace('{media}', amount(p.media)).replace('{history}', amount(p.history)).replace('{talk}', amount(p.talk)).replace('{files}', amount(Math.max(0, p.total - p.media - p.cache - p.history - p.talk)))}>
            {t('settings.storage.projectLine').replace('{size}', amount(Math.max(0, p.total - p.cache))).replace('{clearable}', amount(p.cache))}</span>
        </li>
      ))}
    </ul>
  );
}

/** General's row: how much OpenFilm takes and how much is free on the disk, the storage page a click away. */
export function StorageEntry({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const [usage, setUsage] = React.useState<StorageUsage | null>(null);
  const [free, setFree] = React.useState<number | null>(null);
  React.useEffect(() => {
    let live = true;
    void api.storage().then((u) => { if (live) setUsage(u); }, () => {});
    void api.locations().then((l) => { if (live) setFree(l.projects.free ?? null); }, () => {});
    return () => { live = false; };
  }, []);
  const total = usage ? Object.values(byKind(usage)).reduce((a, b) => a + b, 0) : null;
  const line = [
    `${t('settings.storage.ours')} ${total == null ? '…' : amount(total)}`,
    ...(free != null ? [t('settings.storage.free').replace('{size}', size(free))] : []),
  ].join(' · ');
  return (
    <button type="button" onClick={onOpen} data-storage-row="" className="-mx-3 flex w-[calc(100%+24px)] items-center gap-4 rounded-[10px] px-3 py-4 text-left transition hover:bg-[var(--bg-hover)]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-field)] text-[var(--text)]"><HardDrive size={17} strokeWidth={1.7} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-[var(--text)]">{t('settings.storage.manage')}</span>
        <span className="mt-1 block text-[14px] tabular-nums text-[var(--text-muted)]">{line}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-[var(--text-faint)]" aria-hidden />
    </button>
  );
}

/** `titled`: with its heading (a page that says what it is above it leaves it out) */
export function StorageGroup({ titled = true }: { titled?: boolean }) {
  const t = useT();
  const [where, setWhere] = React.useState<StudioLocations | null>(null);
  const [busy, setBusy] = React.useState<Which | null>(null);
  const [error, setError] = React.useState<{ which: Which; text: string } | null>(null);
  /* where no folder dialog can open (a browser on another system), the path is typed */
  const [typing, setTyping] = React.useState<{ which: Which; text: string } | null>(null);
  /* a new folder for a library with projects in it: whether they move too */
  const [asking, setAsking] = React.useState<{ which: Which; folder: string | null } | null>(null);
  const [note, setNote] = React.useState<{ which: Which; text: string } | null>(null);
  const load = React.useCallback(() => { void api.locations().then(setWhere).catch(() => {}); }, []);
  React.useEffect(load, [load]);
  /* measured once the page is open (every project's folder is read: a moment for a big library) */
  const [usage, setUsage] = React.useState<StorageUsage | null>(null);
  const [clearing, setClearing] = React.useState(false);
  const [cleared, setCleared] = React.useState<number | null>(null);
  React.useEffect(() => { let live = true; void api.storage().then((u) => { if (live) setUsage(u); }, () => {}); return () => { live = false; }; }, []);
  const clear = async () => {
    setClearing(true);
    try { const done = await api.clearStorage(); setUsage(done); setCleared(done.freed); } catch { /* as it was */ } finally { setClearing(false); }
  };
  if (!where) return null;

  const apply = async (which: Which, folder: string | null, move: boolean) => {
    setBusy(which);
    setError(null);
    setNote(null);
    try {
      const done = await api.moveLibrary(folder, move);
      setTyping(null);
      setWhere(done.locations);
      if (done.failed.length) setError({ which, text: t('settings.storage.moveFailed').replace('{names}', done.failed.map((f) => f.name).join(', ')) });
      if (done.moved) {
        const moved = t('settings.storage.moved').replace('{count}', String(done.moved));
        /* across disks, an old folder the trash would not take stays on the old disk: said, with where */
        const left = done.left?.length ? ' ' + t('settings.storage.moveLeft').replace('{paths}', () => done.left.map((f) => f.path).join(', ')) : '';
        setNote({ which, text: moved + left });
      }
    } catch (e) {
      setError({ which, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const keep = (which: Which, folder: string | null) => {
    const now = where[which];
    if (now.count > 0 && (folder ?? now.default) !== now.path) setAsking({ which, folder });
    else void apply(which, folder, false);
  };
  const change = async (which: Which) => {
    const ask = { title: t(`settings.storage.${which}Pick`), button: t('settings.storage.pickButton'), at: where[which].path };
    try {
      const pick = studioHost?.folders?.pick;
      const picked = pick ? await pick(ask) : await api.pickFolder(ask.title, ask.at);
      if (picked) keep(which, picked);
    } catch {
      setTyping({ which, text: where[which].path });
    }
  };

  const row = (which: Which, place: StudioLocation) => (
    <SettingsItem
      key={which}
      title={t(`settings.storage.${which}`)}
      description={(
        <>
          {typing?.which === which ? (
            <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (typing.text.trim()) keep(which, typing.text.trim()); }}>
              <SettingsField autoFocus value={typing.text} onChange={(e) => setTyping({ which, text: e.target.value })} spellCheck={false}
                aria-label={t(`settings.storage.${which}`)} className="font-mono text-[13px]"
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTyping(null); } }} />
              <SettingsButton type="submit" variant="primary" disabled={busy === which || !typing.text.trim()}>{t('settings.storage.save')}</SettingsButton>
            </form>
          ) : (
            <span className="mt-1 block break-all font-mono text-[13px]" title={place.path}>{place.path}</span>
          )}
          {place.free != null ? <span className="mt-0.5 block text-[13px]">{t('settings.storage.free').replace('{size}', size(place.free))}</span> : null}
          {note?.which === which ? <span className="mt-1 block text-[13px]" role="status">{note.text}</span> : null}
          {error?.which === which ? <span className={`mt-1 block ${settingsError}`} role="alert">{error.text}</span> : null}
        </>
      )}
      control={(
        <>
          {place.chosen ? (
            <SettingsButton variant="quiet" disabled={busy === which} onClick={() => keep(which, null)} title={place.default}>{t('settings.storage.reset')}</SettingsButton>
          ) : null}
          <SettingsButton onClick={() => void api.openLocation(which).catch(() => {})}>{t('settings.storage.show')}</SettingsButton>
          <SettingsButton disabled={busy === which} onClick={() => void change(which)}>{t('settings.storage.change')}</SettingsButton>
        </>
      )}
    />
  );

  return (
    <SettingsGroup title={titled ? t('settings.storage.group') : undefined}>
      <div className="pb-2 pt-2"><Overview kinds={usage ? byKind(usage) : null} free={where.projects.free ?? null} /></div>
      {(() => {
        const kinds = usage ? byKind(usage) : null;
        const of = (linked: boolean) => usage?.projects.filter((p) => Boolean(p.linked) === linked) ?? null;
        const note = (k: Kind) => {
          if (k === 'cache' && cleared != null) return t('settings.storage.cleared').replace('{size}', amount(cleared));
          const list = k === 'projects' ? of(false) : k === 'linked' ? of(true) : null;
          return t(`settings.storage.areaNote.${k}`).replace('{count}', list ? String(list.length) : '…');
        };
        return (
          <div data-storage-list="" className="pt-3">
            {/* measured, an area that takes nothing is left out (the projects and the cache stay) */}
            {KINDS.filter((k) => !kinds || k.key === 'projects' || k.key === 'cache' || kinds[k.key] >= SHOWN).map((k) => {
              const list = k.key === 'projects' ? of(false) : k.key === 'linked' ? of(true) : null;
              return (
                <StorageRow key={k.key} icon={<Swatch color={k.color} />} name={t(`settings.storage.area.${k.key}`)} note={note(k.key)}
                  bytes={kinds ? kinds[k.key] : null}
                  action={k.key === 'cache' ? <SettingsButton disabled={!usage || clearing || usage.clearable < 1e6} onClick={() => void clear()}>{t('settings.storage.clear')}</SettingsButton> : undefined}>
                  {list?.length ? <ProjectList projects={list} /> : null}
                </StorageRow>
              );
            })}
          </div>
        );
      })()}
      {row('projects', where.projects)}
      <ConfirmDialog
        open={!!asking}
        title={t('settings.storage.moveTitle')}
        description={asking ? t('settings.storage.moveDesc')
          .replace('{count}', String(where[asking.which].count))
          .replace('{from}', where[asking.which].path)
          .replace('{to}', asking.folder ?? where[asking.which].default) : undefined}
        confirmLabel={t('settings.storage.moveYes')}
        altLabel={t('settings.storage.moveNo')}
        onConfirm={() => { const a = asking; setAsking(null); if (a) void apply(a.which, a.folder, true); }}
        onAlt={() => { const a = asking; setAsking(null); if (a) void apply(a.which, a.folder, false); }}
        onCancel={() => setAsking(null)}
      />
    </SettingsGroup>
  );
}
