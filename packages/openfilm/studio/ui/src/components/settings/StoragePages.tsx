/**
 * Settings → Advanced → Asset management: everything OpenFilm keeps on this computer, as a computer's storage page
 * shows a disk. On top, how much it takes in all, as one bar parted by kind, and the free space left on the disk of
 * the projects; then what can be given back (the cache, made again when needed); then each kind, a page of its own:
 *
 * - the projects' work (film, pages, assets/), their versions, their conversations and logs, their cache, each project
 *   by its share (studio/server/storage.mjs projectUsage), each shown in the file manager; the projects' folder can be
 *   changed there (where new projects go, src/locations.mjs), and the cache cleared, all of it or one project's;
 * - Mine, what was fetched of OpenFilm's library, the models that run here, the skills, and the rest of Studio's home
 *   (storage.mjs places), each with its folders and shown in the file manager.
 *
 * Exports are not counted: they land among the person's own files (the Desktop, or the folder picked).
 */
import React from 'react';
import { Clapperboard, Cpu, Download, FolderHeart, History, MessageSquare, RefreshCcw, Settings2, Zap } from 'lucide-react';
import { useT } from '@/i18n';
import { api, type StoragePlace, type StorageUsage, type StudioLocation, type StudioLocations } from '@/api';
import { studioHost } from '@/lib/host';
import { ConfirmDialog } from '../ConfirmDialog';
import { SettingsButton, SettingsField, SettingsGroup, SettingsItem, SettingsNavRow, SettingsPage, SettingsTile, settingsError } from './ui';

export const STORAGE_KINDS = ['projects', 'saved', 'history', 'talk', 'cache', 'library', 'models', 'skills', 'other'] as const;
export type StorageKind = typeof STORAGE_KINDS[number];

const KIND_COLOR: Record<StorageKind, string> = {
  projects: '#0a84ff', saved: '#30b158', history: '#ff9f0a', talk: '#bf5af2', cache: '#8e8e93',
  library: '#32ade6', models: '#ff375f', skills: '#e3b505', other: '#636366',
};
const KIND_ICON: Record<StorageKind, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  projects: Clapperboard, saved: FolderHeart, history: History, talk: MessageSquare, cache: RefreshCcw,
  library: Download, models: Cpu, skills: Zap, other: Settings2,
};
/** The kinds that are parts of the projects' folders, each project by its share. */
const PROJECT_KINDS = new Set<StorageKind>(['projects', 'history', 'talk', 'cache']);

export function storageTile(kind: StorageKind, size = 28) {
  const Icon = KIND_ICON[kind];
  return <SettingsTile color={KIND_COLOR[kind]} size={size}><Icon size={Math.round(size * 0.56)} strokeWidth={2} /></SettingsTile>;
}

/** Bytes as the person reads a disk's free space: GB, or MB below one. */
function size(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** Bytes a folder takes, down to nothing: GB, MB, KB, or 0. */
export function amount(bytes: number): string {
  if (bytes < 1) return '0 KB';
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  return size(bytes);
}

type Project = StorageUsage['projects'][number];
/** A project's share of a kind: its work is what is left of it without its cache, versions and conversations. */
const share = (p: Project, kind: StorageKind) => kind === 'projects' ? Math.max(0, p.total - p.cache - p.history - p.talk)
  : kind === 'history' ? p.history : kind === 'talk' ? p.talk : kind === 'cache' ? p.cache : 0;

/** Each kind's bytes. */
function kindBytes(usage: StorageUsage): Record<StorageKind, number> {
  const by = Object.fromEntries(STORAGE_KINDS.map((k) => [k, 0])) as Record<StorageKind, number>;
  for (const p of usage.projects) for (const k of PROJECT_KINDS) by[k] += share(p, k);
  for (const place of usage.places ?? []) by[place.id] = place.bytes;
  return by;
}

/* what was measured last, shown at once while it is measured again (every project's folder is read: a moment for a
   big library), and shared by the pages */
let measured: StorageUsage | null = null;
const listeners = new Set<(u: StorageUsage) => void>();
const publish = (u: StorageUsage) => { measured = u; listeners.forEach((l) => l(u)); };

function useStorage() {
  const [usage, setUsage] = React.useState<StorageUsage | null>(measured);
  React.useEffect(() => {
    listeners.add(setUsage);
    void api.storage().then(publish, () => {});
    return () => { listeners.delete(setUsage); };
  }, []);
  return usage;
}

/** The overview: the bar, what can be cleared, and every kind. */
export function StorageOverview({ onOpen }: { onOpen: (kind: StorageKind) => void }) {
  const t = useT();
  const usage = useStorage();
  const [where, setWhere] = React.useState<StudioLocations | null>(null);
  React.useEffect(() => { void api.locations().then(setWhere).catch(() => {}); }, []);
  const by = usage ? kindBytes(usage) : null;
  const total = by ? STORAGE_KINDS.reduce((sum, k) => sum + by[k], 0) : 0;
  const shown = by ? STORAGE_KINDS.filter((k) => by[k] > 0) : [];
  return (
    <SettingsPage note={t('settings.storage.desc')}>
      <section className="mb-6 rounded-[12px] bg-[var(--settings-card)] px-4 pb-4 pt-3.5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-[15px] font-semibold text-[var(--text)]">OpenFilm</span>
          <span className="text-[14px] tabular-nums text-[var(--text-muted)]">
            {usage ? t('settings.storage.totalLine').replace('{size}', amount(total)) : t('settings.storage.usageLoading')}
          </span>
        </div>
        <div data-storage-bar="" className="mt-3 flex h-[22px] overflow-hidden rounded-[6px] bg-[var(--bg-field)]">
          {by && total > 0 ? shown.map((k) => (
            <span key={k} title={`${t(`settings.storage.kinds.${k}`)} · ${amount(by[k])}`}
              style={{ width: `${Math.max(0.6, (by[k] / total) * 100)}%`, background: KIND_COLOR[k] }} className="h-full border-r border-[var(--settings-card)] last:border-r-0" />
          )) : null}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--text-muted)]">
          {shown.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{t(`settings.storage.kinds.${k}`)}
            </span>
          ))}
        </div>
        {where?.projects.free != null ? (
          <p className="mt-2 text-[13px] text-[var(--text-faint)]">{t('settings.storage.free').replace('{size}', size(where.projects.free))}</p>
        ) : null}
      </section>
      {usage && usage.clearable >= 1e6 ? <ClearGroup usage={usage} /> : null}
      <SettingsGroup>
        {STORAGE_KINDS.map((k) => (
          <SettingsNavRow key={k} tile={storageTile(k)} title={t(`settings.storage.kinds.${k}`)}
            value={by ? amount(by[k]) : '…'} onClick={() => onOpen(k)} />
        ))}
      </SettingsGroup>
    </SettingsPage>
  );
}

/** The cache, all of it cleared at once. */
function ClearGroup({ usage }: { usage: StorageUsage }) {
  const t = useT();
  const [clearing, setClearing] = React.useState(false);
  const [cleared, setCleared] = React.useState<number | null>(null);
  const clear = async () => {
    setClearing(true);
    try { const done = await api.clearStorage(); publish(done); setCleared(done.freed); } catch { /* as it was */ } finally { setClearing(false); }
  };
  return (
    <SettingsGroup title={t('settings.storage.suggest')}>
      <SettingsItem mark={storageTile('cache', 36)} title={t('settings.storage.clear')}
        description={(
          <>
            {t('settings.storage.clearDesc').replace('{size}', amount(usage.clearable))}
            {cleared != null ? <span className="mt-1 block" role="status">{t('settings.storage.cleared').replace('{size}', amount(cleared))}</span> : null}
          </>
        )}
        control={<SettingsButton disabled={clearing || usage.clearable < 1e6} onClick={() => void clear()}>{t('settings.storage.clearOne')}</SettingsButton>} />
    </SettingsGroup>
  );
}

/** One kind: what it is, and where it is (each project by its share, or its folders). */
export function StorageKindPage({ kind }: { kind: StorageKind }) {
  const t = useT();
  const usage = useStorage();
  const total = usage ? kindBytes(usage)[kind] : null;
  return (
    <SettingsPage>
      <div className="mb-6 flex items-center gap-4 rounded-[12px] bg-[var(--settings-card)] px-4 py-4">
        {storageTile(kind, 44)}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[17px] font-semibold text-[var(--text)]">{t(`settings.storage.kinds.${kind}`)}</h2>
            <span className="shrink-0 text-[15px] tabular-nums text-[var(--text-muted)]">{total == null ? t('settings.storage.usageLoading') : amount(total)}</span>
          </div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">{t(`settings.storage.about.${kind}`)}</p>
        </div>
      </div>
      {kind === 'projects' ? <ProjectsLocationGroup /> : null}
      {kind === 'cache' && usage && usage.clearable >= 1e6 ? <ClearGroup usage={usage} /> : null}
      {usage ? (PROJECT_KINDS.has(kind) ? <EachProject kind={kind} usage={usage} /> : <PlaceFolders place={(usage.places ?? []).find((p) => p.id === kind)} />) : null}
    </SettingsPage>
  );
}

/** Each project's share of a kind, the biggest first; each shown in the file manager (the cache: each cleared). */
function EachProject({ kind, usage }: { kind: StorageKind; usage: StorageUsage }) {
  const t = useT();
  const [busy, setBusy] = React.useState<string | null>(null);
  const listed = usage.projects.filter((p) => share(p, kind) > 0).sort((a, b) => share(b, kind) - share(a, kind));
  if (!listed.length) return <p className="px-1 text-[14px] text-[var(--text-faint)]">{t('settings.storage.empty')}</p>;
  const clear = async (id: string) => {
    setBusy(id);
    try { publish(await api.clearStorage(id)); } catch { /* as it was */ } finally { setBusy(null); }
  };
  return (
    <SettingsGroup title={t('settings.storage.eachProject')}>
      <div data-storage-projects="" className="flex flex-col divide-y divide-[var(--border)]">
        {listed.map((p) => (
          <SettingsItem key={p.id} title={p.name}
            description={<span className="block truncate font-mono text-[12.5px]" title={p.path}>{p.path}</span>}
            control={(
              <>
                <span className="mr-1 text-[14px] tabular-nums text-[var(--text-muted)]">{amount(share(p, kind))}</span>
                {kind === 'cache' ? (
                  <SettingsButton disabled={busy === p.id || p.clearable < 1e5} onClick={() => void clear(p.id)}>{t('settings.storage.clearOne')}</SettingsButton>
                ) : null}
                <SettingsButton variant="quiet" onClick={() => void api.revealProject(p.id).catch(() => {})}>{t('settings.storage.reveal')}</SettingsButton>
              </>
            )} />
        ))}
      </div>
    </SettingsGroup>
  );
}

/** A place's folders, shown in the file manager. */
function PlaceFolders({ place }: { place: StoragePlace | undefined }) {
  const t = useT();
  if (!place) return null;
  return (
    <SettingsGroup title={t('settings.storage.folders')}>
      {place.paths.map((path) => (
        <SettingsItem key={path} title={<span className="break-all font-mono text-[13px]">{path}</span>} />
      ))}
      <SettingsItem title={t('settings.storage.reveal')}
        control={<SettingsButton onClick={() => void api.openStoragePlace(place.id).catch(() => {})}>{t('settings.storage.show')}</SettingsButton>} />
    </SettingsGroup>
  );
}

type Which = keyof StudioLocations;

/**
 * Where new projects go (src/locations.mjs): its folder and the free space on its disk; changed (the system's folder
 * dialog), opened in the file manager, or set back to its default. When projects are in it, a change asks whether
 * they move too; left behind, they stay where they are, and in the list.
 */
export function ProjectsLocationGroup() {
  const t = useT();
  const [where, setWhere] = React.useState<StudioLocations | null>(null);
  const [busy, setBusy] = React.useState<Which | null>(null);
  const [error, setError] = React.useState<{ which: Which; text: string } | null>(null);
  /* where no folder dialog can open (a browser on another system), the path is typed */
  const [typing, setTyping] = React.useState<{ which: Which; text: string } | null>(null);
  /* a new folder for a library with projects in it: whether they move too */
  const [asking, setAsking] = React.useState<{ which: Which; folder: string | null } | null>(null);
  const [note, setNote] = React.useState<{ which: Which; text: string } | null>(null);
  React.useEffect(() => { void api.locations().then(setWhere).catch(() => {}); }, []);
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
      void api.storage().then(publish, () => {});
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
    <SettingsGroup title={t('settings.storage.group')}>
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
