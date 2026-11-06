/**
 * A skill on its own, in the library's Skills (library/SkillsPane) in place of its tiles: its preview (or picture),
 * then its title and switch (on, an agent takes it up whenever it fits; off, no agent gets it), kind and version,
 * where it came from, what it does, and what to do with it: Try now (a new conversation with the skill named in its
 * message; installed or not, the skill is given to that conversation only), Install, or uninstalling it (an official
 * one) or moving it to the trash (the person's own, a project's); OpenFilm's system skills are only turned off. Back
 * returns to the list. Also here: a skill's words
 * in the language shown, and its cover.
 */
import React from 'react';
import {
  ArrowLeft, Copy, Film, Folder, GitBranch, Github, Layers, MessageSquarePlus, MonitorPlay, Music, PenLine,
  PictureInPicture2, Plus, Presentation, RefreshCw, Scissors, Shapes, Sparkles, Trash2, Wand2, type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { communityOf, makerOf, sourcesApi, type SkillEntry } from '@/lib/project-sources';
import { ConfirmDialog } from './ConfirmDialog';
import { SettingsSwitch } from './settings/ui';

/** OpenFilm's own by their order, then the community's as Discover's index lists them (an author's own order is not theirs to set). */
export const byOrder = (a: SkillEntry, b: SkillEntry) => {
  const ca = communityOf(a), cb = communityOf(b);
  if (ca !== cb) return ca ? 1 : -1;
  return ca ? 0 : (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name);
};
/** words in the language shown, else its family's, else English, else any */
export const inLanguage = (words: Record<string, string> | undefined, lang: string) =>
  (words ? words[lang] ?? words[lang.split('-')[0]!] ?? words.en ?? Object.values(words)[0] : undefined);

/** A skill as people see it: its title and summary in the language shown, else its name and the agent's description. */
export function useSkillWords() {
  const lang = useLanguage();
  return (skill: SkillEntry) => ({
    title: inLanguage(skill.shown?.title, lang) ?? skill.name,
    summary: inLanguage(skill.shown?.summary, lang) ?? skill.description,
  });
}

/** An official one not installed is in the catalog only; the person's own and a project's are installed already. */
const installedOf = (skill: SkillEntry) => skill.installed !== false;

export function SkillPage({ skill, setSkills, projectId, onBack, onTry }: {
  skill: SkillEntry;
  /** the list it is in: each change shown there at once, then read again */
  setSkills: React.Dispatch<React.SetStateAction<SkillEntry[]>>;
  projectId: string | null;
  onBack: () => void;
  /** Try now (none: Studio without the app's chat) */
  onTry?: (skill: SkillEntry) => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const words = useSkillWords()(skill);
  const details = inLanguage(skill.shown?.details, lang);
  const needs = inLanguage(skill.needs, lang);
  const installed = installedOf(skill);
  const group = skill.core ? 'assetDrawer.skillsSystem' : skill.source === 'official' ? (skill.kind === 'style' ? 'gallery.style' : 'gallery.workflow') : skill.source === 'mine' ? 'gallery.mine' : 'gallery.project';
  const source = skill.repository ?? (skill.origin?.from === 'link' ? skill.origin.address : undefined);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const coverInput = React.useRef<HTMLInputElement>(null);

  const patch = (change: (k: SkillEntry) => SkillEntry) => setSkills((list) => list.map((k) => (k.uid === skill.uid ? change(k) : k)));
  const reload = () => { void sourcesApi.skills(projectId).then(setSkills); };
  const turn = (on: boolean) => {
    patch((k) => { const { off: _was, ...rest } = k; return on ? rest : { ...rest, off: true }; });
    void sourcesApi.setSkillOn(skill.uid, on).catch(reload);
  };
  /* installing downloads it (a few seconds): said while it does, and why when it cannot */
  const [working, setWorking] = React.useState<'installing' | 'updating' | null>(null);
  const install = (on: boolean) => {
    if (!on) {
      patch((k) => { const { off: _was, ...rest } = k; return { ...rest, installed: false }; });
      void sourcesApi.setSkillInstalled(skill.uid, false).catch(reload);
      return;
    }
    setWorking('installing');
    setError(null);
    void sourcesApi.setSkillInstalled(skill.uid, true).then(
      () => { patch((k) => { const { off: _was, ...rest } = k; return { ...rest, installed: true }; }); reload(); },
      (e) => setError(t('gallery.installFailed').replace('{why}', e instanceof Error ? e.message : String(e))),
    ).finally(() => setWorking(null));
  };
  const update = () => {
    setWorking('updating');
    setError(null);
    void sourcesApi.updateSkill(skill.uid).then(reload, (e) => setError(t('gallery.installFailed').replace('{why}', e instanceof Error ? e.message : String(e))))
      .finally(() => setWorking(null));
  };
  /* an official one is only uninstalled (it stays in Discover); the person's own or a project's goes to the trash */
  const remove = () => {
    setRemoving(false);
    onBack();
    setSkills((list) => list.filter((k) => k.uid !== skill.uid));
    void sourcesApi.removeSkill(skill.uid, projectId).finally(reload);
  };
  const changeCover = async (file: File | null) => {
    setBusy(true);
    setError(null);
    try {
      let cover: string | null = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('gallery.coverInvalid'));
        cover = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(t('gallery.coverInvalid')));
          reader.readAsDataURL(file);
        });
        const image = new Image();
        image.src = cover;
        await image.decode().catch(() => { throw new Error(t('gallery.coverInvalid')); });
      }
      const kept = await sourcesApi.setSkillCover(skill.uid, cover, projectId);
      patch((k) => (k.source === 'mine' ? { ...k, cover: kept ?? undefined } : k));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <>
    {/* Back where the search was, at its height, so the page comes in without a jump */}
    <div className="flex shrink-0 px-3 pb-2 pt-2.5">
      <button type="button" onClick={onBack} className="-ml-1 flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[12.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
        <ArrowLeft size={14} />{t('gallery.back')}
      </button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-0.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-black ring-1 ring-[var(--border)]">
        {skill.preview ? <video src={skill.preview} poster={skill.cover} autoPlay muted loop controls playsInline className="absolute inset-0 h-full w-full object-contain" />
          : <SkillCover key={skill.cover ?? ''} skill={skill} title={words.title} big />}
      </div>
      {skill.source === 'mine' ? <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
        <button type="button" disabled={busy} onClick={() => coverInput.current?.click()} className="h-8 rounded-[8px] px-2.5 text-[12.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40">{t(skill.cover ? 'gallery.changeCover' : 'gallery.chooseCover')}</button>
        <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t(skill.cover ? 'gallery.changeCover' : 'gallery.chooseCover')} disabled={busy} hidden
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void changeCover(file); }} />
        {skill.cover ? <button type="button" disabled={busy} onClick={() => void changeCover(null)} className="h-8 rounded-[8px] px-2.5 text-[12.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40">{t('gallery.removeCover')}</button> : null}
        {busy ? <span role="status">{t('gallery.coverSaving')}</span> : null}
      </div> : null}
      {error ? <p role="alert" className="mt-2 text-[12px] text-[var(--warn)]">{error}</p> : null}
      <div className="mt-4 flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-[17px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{words.title}</h2>
        {installed ? <SettingsSwitch checked={!skill.off} onChange={turn} label={t(skill.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', words.title)} /> : null}
      </div>
      {skill.off ? <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">{t('gallery.skillOff')}</p> : null}
      {skill.retired ? <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">{t('gallery.retired')}</p> : null}
      <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
        {/* the community's: whose it is, their account a link; OpenFilm's own: its kind */}
        {communityOf(skill) ? (
          <span>{t('gallery.byCommunity').split('{owner}')[0]}<a href={`https://github.com/${makerOf(skill)}`} target="_blank" rel="noreferrer"
            className="text-[var(--text)] underline-offset-2 hover:underline">{makerOf(skill)}</a>{t('gallery.byCommunity').split('{owner}')[1]}</span>
        ) : <span>{t(group)}</span>}
        {/* its uid, owner/name: how it is told apart, shared and searched */}
        <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-faint)]" title={skill.uid}>{skill.uid}</span>
        {skill.version ? <span className="rounded-[5px] border border-[var(--border)] px-1.5 py-[1px] font-mono text-[10.5px] text-[var(--text-muted)]">v{skill.version}</span> : null}
        {/* its source: OpenFilm's repository, or the address one of the person's came from */}
        {source ? (
          <a href={source} target="_blank" rel="noreferrer" title={source} aria-label={t('gallery.viewSource')}
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><Github size={14} strokeWidth={1.75} /></a>
        ) : null}
      </div>
      <Origin skill={skill} />
      {words.summary ? <p className="mt-4 text-[13px] leading-[20px] text-[var(--text)]">{words.summary}</p> : null}
      {/* the computers it runs on, when this one is not among them; what it needs beyond OpenFilm */}
      {skill.elsewhere && skill.platforms ? (
        <p role="note" className="mt-2.5 text-[12.5px] leading-[20px] text-[var(--warn)]">
          {t('gallery.onlyOn').replace('{where}', skill.platforms.map((p) => t(`gallery.platform_${p}`)).join(' / '))}</p>
      ) : null}
      {needs ? <p className="mt-2.5 text-[12.5px] leading-[20px] text-[var(--text-muted)]"><span className="font-medium text-[var(--text)]">{t('gallery.needs')}</span> {needs}</p> : null}
      {/* scripts it brings run on this computer, with the agent's access */}
      {skill.scripts > 0 && !skill.core ? (
        <p className="mt-2.5 text-[12.5px] leading-[20px] text-[var(--text-muted)]">{t(skill.scripts === 1 ? 'gallery.scriptsOne' : 'gallery.scriptsMany').replace('{n}', String(skill.scripts))}</p>
      ) : null}
      {/* each line of its details; a line's lead ("When it is used:") a shade brighter, to find at a glance */}
      {details ? details.split('\n').map((line) => {
        const lead = /^(.{1,24}?[：:])\s*(.+)$/.exec(line);
        return (
          <p key={line} className="mt-2.5 text-[12.5px] leading-[20px] text-[var(--text-muted)]">
            {lead ? <><span className="font-medium text-[var(--text)]">{lead[1]}</span> {lead[2]}</> : line}
          </p>
        );
      }) : null}
      <div className="mt-5 flex flex-col gap-2">
        {onTry ? (
          <button type="button" onClick={() => onTry(skill)} disabled={skill.off} title={skill.off ? t('gallery.tryOff') : undefined}
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--primary)] text-[13px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-40"><MessageSquarePlus size={15} />{t('gallery.tryNow')}</button>
        ) : null}
        {/* OpenFilm's system skills are only turned off */}
        {skill.update && installed ? (
          <button type="button" onClick={update} disabled={working !== null}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50">
            <RefreshCw size={14} />{working === 'updating' ? t('gallery.updating') : t('gallery.update').replace('{version}', skill.update.version)}</button>
        ) : null}
        {skill.core ? null : !installed ? (
          <button type="button" onClick={() => install(true)} disabled={working !== null || skill.elsewhere === true}
            className={onTry
              ? 'flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50'
              : 'flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--primary)] text-[13px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50'}><Plus size={15} />{t(working === 'installing' ? 'gallery.installing' : 'gallery.install')}</button>
        ) : (
          <button type="button" onClick={() => { if (skill.source === 'official') install(false); else setRemoving(true); }}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--bg-field)] text-[13px] text-[var(--text-muted)] transition hover:bg-[color-mix(in_srgb,var(--err)_14%,var(--bg-field))] hover:text-[var(--err)]">
            <Trash2 size={14} />{t(skill.source === 'official' ? 'gallery.uninstall' : 'gallery.remove')}
          </button>
        )}
      </div>
      <ConfirmDialog open={removing} danger
        title={t('gallery.removeTitle').replace('{name}', words.title)}
        description={t('gallery.removeHint')} confirmLabel={t('gallery.remove')}
        onCancel={() => setRemoving(false)} onConfirm={remove} />
    </div>
    </>
  );
}

/** A skill's mark at the start of its line in a list: its cover, else its icon in its own color. */
export function SkillMark({ skill }: { skill: Pick<SkillEntry, 'cover' | 'icon'> }) {
  const [failed, setFailed] = React.useState(false);
  if (skill.cover && !failed) {
    return <img src={skill.cover} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="h-8 w-8 shrink-0 rounded-[7px] object-cover ring-1 ring-[var(--border)]" />;
  }
  const Mark = ICONS[skill.icon ?? ''] ?? Sparkles;
  const hue = HUES[skill.icon ?? ''] ?? 220;
  return (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px]"
      style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `hsl(${hue} 80% 72%)`, boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
      <Mark size={15} strokeWidth={1.7} />
    </span>
  );
}

/** Where one of the person's skills came from, as a short line: GitHub · owner/repo, a folder's name, or made here. */
function Origin({ skill }: { skill: SkillEntry }) {
  const t = useT();
  const o = skill.origin;
  if (!o) return null;
  let icon = <Wand2 size={12} />, text = t('gallery.made');
  if (o.from === 'link') {
    icon = <GitBranch size={12} />;
    try { const u = new URL(o.address); text = `${u.hostname.replace(/^www\./, '').replace(/\.com$/, '').replace(/^github$/, 'GitHub').replace(/^gitlab$/, 'GitLab')} · ${u.pathname.split('/').filter(Boolean).slice(0, 2).join('/')}`; } catch { text = o.address; }
  } else if (o.from === 'folder') {
    icon = <Folder size={12} />;
    text = `${t('gallery.fromFolder')} · ${o.address.split(/[\\/]/).filter(Boolean).pop() ?? o.address}`;
  }
  return (
    <>
      <div title={o.from === 'made' ? undefined : o.address} className="mt-2 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--text-faint)]">{icon}<span className="truncate">{text}</span></div>
      {/* added from an address, not from Discover: OpenFilm has not looked at it */}
      {o.from === 'link' ? <p className="mt-1 text-[11.5px] leading-[17px] text-[var(--text-muted)]">{t('gallery.unlisted')}</p> : null}
    </>
  );
}

const ICONS: Record<string, LucideIcon> = {
  copy: Copy, scissors: Scissors, monitor: MonitorPlay, shapes: Shapes, pip: PictureInPicture2, pen: PenLine, film: Film,
  music: Music, presentation: Presentation, layers: Layers,
};
/** each mark its own color, so the covers tell apart at a glance */
const HUES: Record<string, number> = { copy: 212, scissors: 18, monitor: 188, shapes: 262, pip: 328, pen: 42, film: 28, music: 286, presentation: 228, layers: 6 };

/** A skill's picture: its cover, else its preview's first frame, else a tile of its mark in its own color. */
export function SkillCover({ skill, title, small = false, big = false, playing = false }: { skill: SkillEntry; title: string; small?: boolean; big?: boolean; playing?: boolean }) {
  const [failed, setFailed] = React.useState(false);
  if (skill.cover && !failed) {
    return (
      <>
        <img src={skill.cover} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        {playing && skill.preview ? <video src={skill.preview} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
      </>
    );
  }
  const Mark = ICONS[skill.icon ?? ''] ?? Sparkles;
  const hue = HUES[skill.icon ?? ''] ?? 220;
  return (
    <div aria-label={title} className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
      style={{ background: `radial-gradient(110% 90% at 25% 0%, hsl(${hue} 70% 55% / 0.22), transparent 62%), radial-gradient(90% 80% at 100% 100%, hsl(${hue} 70% 50% / 0.12), transparent 60%), var(--bg-field)` }}>
      <span className={`flex items-center justify-center ${small ? 'h-7 w-7 rounded-[8px]' : big ? 'h-16 w-16 rounded-[14px]' : 'h-14 w-14 rounded-[14px]'}`}
        style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `hsl(${hue} 80% 72%)`, boxShadow: `0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
        <Mark size={small ? 14 : big ? 28 : 24} strokeWidth={1.6} />
      </span>
      {/* a card has its title under it; the page's big picture carries it */}
      {big ? <span className="line-clamp-2 text-[22px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</span> : null}
    </div>
  );
}
