/**
 * A skill on its own, in the library's Plugins (library/PluginsPane) in place of its list: its preview (or picture),
 * then its title and switch (on, an agent takes it up whenever it fits; off, no agent gets it), kind and version,
 * where it came from, what it does, how to use it, what it brings (a plugin someone made: its workbench or its tab of
 * the library; the skill an agent is given, with what the agent is told of it; its commands), what it may do on this
 * computer (its scripts; a plugin's leave to change the project and to run, the person's to give), and what to do
 * with it: Try now (a new conversation with the skill named in its message; installed or not, the skill is given to
 * that conversation only), Install, or uninstalling it (an official one) or moving it to the trash (the person's own,
 * a project's); OpenFilm's system skills are only turned off. Back returns to the list. Also here: a skill's words in
 * the language shown, its cover, and the parts a plugin's page (library/PluginsPane) is made of as well.
 */
import React from 'react';
import { LARGE_DIALOG_COLUMN as PAGE_INSET } from './dialog-chrome';
import {
  ArrowLeft, ChevronRight, Copy, Flag, Film, Folder, GitBranch, Github, Layers, MessageSquarePlus, MonitorPlay, Music, PenLine, PictureInPicture2,
  Plus, Presentation, RefreshCw, Scissors, Shapes, Sparkles, Trash2, Wand2, type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { usePlugins } from '@/lib/plugins';
import { isPlugin } from '@/lib/project-plugins';
import { communityOf, makerOf, ownerOf, sourcesApi, type SkillEntry } from '@/lib/project-sources';
import { usesOfSkill } from '@/lib/plugin-profile';
import { ConfirmDialog } from './ConfirmDialog';
import { ProfileStrip } from './library/PluginProfile';
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

/** What a page's thing is made of (the skills an agent is given, commands, its name for code), folded under "For developers":
    a person deciding whether to use it needs none of it. */
export function ForDevelopers({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <details className="group mt-6 border-t border-[var(--border)] pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13.5px] text-[var(--text-faint)] outline-none transition hover:text-[var(--text-muted)] [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="transition-transform group-open:rotate-90" aria-hidden />{t('assetDrawer.forDevelopers')}
      </summary>
      <div className="pt-1">{children}</div>
    </details>
  );
}

/** A part of a plugin's or a skill's page: its head, and what is under it. */
export function PageSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-1.5 text-[13px] font-medium text-[var(--text-muted)]">{title}</h3>
      {children}
    </section>
  );
}

/** How to use it (or, `where`, where to open it), in one line under its head. */
export function HowToUse({ text, where = false }: { text: string; where?: boolean }) {
  const t = useT();
  return (
    <p data-how-to-use="" className="mt-4 rounded-[10px] bg-[var(--bg-field)] px-3 py-2 text-[14px] leading-[19px] text-[var(--text)]">
      <span className="font-medium">{t(where ? 'assetDrawer.whereToOpen' : 'assetDrawer.howToUse')}</span> <span className="text-[var(--text-muted)]">{text}</span>
    </p>
  );
}

/** One thing it brings: what it is, and under it its name or what it is for. */
export function BringsLine({ kind, children }: { kind: string; children: React.ReactNode }) {
  return (
    <div className="py-1 text-[14px] leading-[18px]">
      <div className="text-[12px] leading-[15px] text-[var(--text-faint)]">{kind}</div>
      <div className="mt-0.5 min-w-0 text-[var(--text)]">{children}</div>
    </div>
  );
}

/** The commands it brings, as an agent (or a plugin) runs them: `openfilm <its name> <command>`. */
export function CommandChips({ name, commands }: { name: string; commands: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {commands.map((c) => (
        <code key={c} className="rounded-[5px] border border-[var(--border)] px-1.5 py-[1px] font-mono text-[12px] text-[var(--text-muted)]">openfilm {name}{c === name ? '' : ` ${c}`}</code>
      ))}
    </div>
  );
}

export function SkillPage({ skill, setSkills, projectId, onBack, onTry, onOn }: {
  skill: SkillEntry;
  /** the list it is in: each change shown there at once, then read again */
  setSkills: React.Dispatch<React.SetStateAction<SkillEntry[]>>;
  projectId: string | null;
  onBack: () => void;
  /** Try now (none: Studio without the app's chat) */
  onTry?: (skill: SkillEntry) => void;
  /** it was turned on here */
  onOn?: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const plugins = usePlugins();
  const words = useSkillWords()(skill);
  const details = inLanguage(skill.shown?.details, lang);
  const needs = inLanguage(skill.needs, lang);
  const installed = installedOf(skill);
  const group = skill.core ? 'assetDrawer.skillsSystem' : skill.source === 'official' ? (skill.kind === 'style' ? 'gallery.style' : 'gallery.workflow') : skill.source === 'mine' ? 'gallery.mine' : 'gallery.project';
  const source = skill.repository ?? (skill.origin?.from === 'link' ? skill.origin.address : undefined);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);
  /* one made by someone else that brings scripts: asked before it is installed */
  const consent = useScriptsConsent();
  const coverInput = React.useRef<HTMLInputElement>(null);

  const patch = (change: (k: SkillEntry) => SkillEntry) => setSkills((list) => list.map((k) => (k.uid === skill.uid ? change(k) : k)));
  const reload = () => { void sourcesApi.skills(projectId).then(setSkills); };
  const turn = (on: boolean) => {
    patch((k) => { const { off: _was, plugin: _plugin, ...rest } = k; return on ? rest : { ...rest, off: true }; });
    void sourcesApi.setSkillOn(skill.uid, on).then(() => { if (on) onOn?.(); }, reload);
  };
  const plugin = isPlugin(skill);
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
    <div className={`flex shrink-0 ${PAGE_INSET} pb-2 pt-6`}>
      <button type="button" onClick={onBack} className="-ml-1 flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[14px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
        <ArrowLeft size={14} />{t('gallery.back')}
      </button>
    </div>
    <div className={`min-h-0 flex-1 overflow-y-auto ${PAGE_INSET} pb-12 pt-0.5`}>
      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-black ring-1 ring-[var(--border)]">
        {skill.preview ? <video src={skill.preview} poster={skill.cover} autoPlay muted loop controls playsInline className="absolute inset-0 h-full w-full object-contain" />
          : <SkillCover key={skill.cover ?? ''} skill={skill} title={words.title} big />}
      </div>
      {skill.source === 'mine' ? <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-[var(--text-muted)]">
        <button type="button" disabled={busy} onClick={() => coverInput.current?.click()} className="h-8 rounded-[8px] px-2.5 text-[14px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40">{t(skill.cover ? 'gallery.changeCover' : 'gallery.chooseCover')}</button>
        <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t(skill.cover ? 'gallery.changeCover' : 'gallery.chooseCover')} disabled={busy} hidden
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void changeCover(file); }} />
        {skill.cover ? <button type="button" disabled={busy} onClick={() => void changeCover(null)} className="h-8 rounded-[8px] px-2.5 text-[14px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40">{t('gallery.removeCover')}</button> : null}
        {busy ? <span role="status">{t('gallery.coverSaving')}</span> : null}
      </div> : null}
      {error ? <p role="alert" className="mt-2 text-[13.5px] text-[var(--warn)]">{error}</p> : null}
      {/* withdrawn by OpenFilm: said first, with why and where to read more */}
      {skill.revoked ? (
        <section role="alert" className="mt-5 rounded-[12px] border border-[color-mix(in_srgb,var(--err)_45%,transparent)] bg-[color-mix(in_srgb,var(--err)_8%,transparent)] p-4">
          <h3 className="text-[15px] font-semibold text-[var(--text)]">{t('gallery.revokedTitle')}</h3>
          <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-muted)]">
            {t('gallery.revokedNote').replace('{reason}', t(`gallery.revoked_${skill.revoked.reason}`))}{skill.revoked.note ? ` ${skill.revoked.note}` : ''}
          </p>
          {skill.revoked.advisory ? <a href={skill.revoked.advisory} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[14px] text-[var(--text)] underline underline-offset-2">{t('gallery.revokedAdvisory')}</a> : null}
        </section>
      ) : null}
      {/* brought by the project: looked at whole before it is let in (src/skills.mjs projectSkillAllowed) */}
      {skill.waits && projectId ? <ProjectSkillReview skill={skill} projectId={projectId} onAllowed={reload} /> : null}
      <div className="mt-4 flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{words.title}</h2>
        {/* one of OpenFilm's own has no switch of its own: it is on while its plugin is (library/PluginsPane) */}
        {installed && !skill.core && !skill.waits && !skill.revoked ? <SettingsSwitch checked={!skill.off} onChange={turn} label={t(skill.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', words.title)} /> : null}
      </div>
      {skill.off ? <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">{skill.plugin ? t('gallery.skillOffPlugin').replace('{plugin}', inLanguage(plugins.find((p) => p.id === skill.plugin)?.title, lang) ?? skill.plugin) : t('gallery.skillOff')}</p> : null}
      {skill.retired ? <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">{t('gallery.retired')}</p> : null}
      <div className="mt-2 flex items-center gap-2 text-[13.5px] text-[var(--text-muted)]">
        {/* what it is (a workbench, or a skill), then whose: the community's, their account a link; OpenFilm's own, its kind */}
        <span>{t(isPlugin(skill) ? 'assetDrawer.kind_workbench' : 'assetDrawer.kind_skill')} ·</span>
        {communityOf(skill) ? (
          <span>{t('gallery.byCommunity').split('{owner}')[0]}<a href={`https://github.com/${makerOf(skill)}`} target="_blank" rel="noreferrer"
            className="text-[var(--text)] underline-offset-2 hover:underline">{makerOf(skill)}</a>{t('gallery.byCommunity').split('{owner}')[1]}</span>
        ) : <span>{t(group)}</span>}
        {skill.version ? <span className="rounded-[5px] border border-[var(--border)] px-1.5 py-[1px] font-mono text-[11.5px] text-[var(--text-muted)]">v{skill.version}</span> : null}
        {/* its source: OpenFilm's repository, or the address one of the person's came from */}
        {source ? (
          <a href={source} target="_blank" rel="noreferrer" title={source} aria-label={t('gallery.viewSource')}
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><Github size={14} strokeWidth={1.75} /></a>
        ) : null}
      </div>
      <Origin skill={skill} />
      {words.summary ? <p className="mt-4 text-[15px] leading-[21px] text-[var(--text)]">{words.summary}</p> : null}
      {/* summed up as a model's page does: how hard, how little work, what it costs, how it is used, who it is for */}
      <ProfileStrip profile={skill.profile} uses={usesOfSkill(skill)} />
      {/* the computers it runs on, when this one is not among them; what it needs beyond OpenFilm */}
      {skill.elsewhere && skill.platforms ? (
        <p role="note" className="mt-2.5 text-[14px] leading-[20px] text-[var(--warn)]">
          {t('gallery.onlyOn').replace('{where}', skill.platforms.map((p) => t(`gallery.platform_${p}`)).join(' / '))}</p>
      ) : null}
      {needs ? <p className="mt-2.5 text-[14px] leading-[20px] text-[var(--text-muted)]"><span className="font-medium text-[var(--text)]">{t('gallery.needs')}</span> {needs}</p> : null}
      {/* each line of its details; a line's lead ("When it is used:") a shade brighter, to find at a glance */}
      {details ? details.split('\n').map((line) => {
        const lead = /^(.{1,24}?[：:])\s*(.+)$/.exec(line);
        return (
          <p key={line} className="mt-2.5 text-[14px] leading-[20px] text-[var(--text-muted)]">
            {lead ? <><span className="font-medium text-[var(--text)]">{lead[1]}</span> {lead[2]}</> : line}
          </p>
        );
      }) : null}
      {/* how to use it: a plugin's surface where it is, else ask the agent */}
      {installed ? <HowToUse text={t(!plugin ? 'assetDrawer.howSkill' : skill.tab ? 'assetDrawer.howTab' : 'assetDrawer.howWorkbench')} /> : null}
      {/* what it is made of, for whoever makes such things: folded */}
      <ForDevelopers>
      <PageSection title={t('assetDrawer.pluginBrings')}>
        {plugin ? <BringsLine kind={t(skill.tab ? 'assetDrawer.brings_tab' : 'assetDrawer.brings_workbench')}>{inLanguage(skill.tab?.title, lang) ?? words.title}</BringsLine> : null}
        {/* the skill an agent is given, with what it is told of it */}
        <BringsLine kind={t('assetDrawer.brings_skill')}><span className="font-mono text-[13px]">{skill.as ?? skill.name}</span><span className="block text-[13px] leading-[17px] text-[var(--text-muted)]">{skill.description}</span></BringsLine>
        {skill.commands?.length ? <BringsLine kind={t('assetDrawer.brings_commands')}><CommandChips name={skill.name} commands={skill.commands} /></BringsLine> : null}
      </PageSection>
      {/* its uid, owner/name: how it is told apart, shared and searched */}
      <p className="mt-4 truncate font-mono text-[12px] text-[var(--text-faint)]" title={skill.uid}>{skill.uid}</p>
      </ForDevelopers>
      {/* one not OpenFilm's own can be reported: what it is named, by email (SECURITY.md) */}
      {ownerOf(skill) !== 'openfilm' && skill.source !== 'mine' ? (
        <a href={`mailto:support@openfilm.dev?subject=${encodeURIComponent(`Report ${skill.uid}`)}`}
          className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] text-[var(--text-faint)] transition hover:text-[var(--text)]">
          <Flag size={13} aria-hidden />{t('gallery.report')}
        </a>
      ) : null}
      {(skill.scripts > 0 && !skill.core) || ((skill.surface || skill.program || skill.inApp) && installed) ? (
        <PageSection title={t('assetDrawer.pluginMay')}>
          {/* scripts it brings run on this computer, with the agent's access */}
          {skill.scripts > 0 && !skill.core ? (
            <p className="text-[14px] leading-[20px] text-[var(--text-muted)]">{t(skill.scripts === 1 ? 'gallery.scriptsOne' : 'gallery.scriptsMany').replace('{n}', String(skill.scripts))}</p>
          ) : null}
          {/* the hosts its page may reach, and nothing else (enforced on the plugins' origin) */}
          {skill.surface ? (
            <p className="mt-1 text-[14px] leading-[20px] text-[var(--text-muted)]">
              {skill.network?.domains.length
                ? <>{t('gallery.networkSome')} <span className="font-mono text-[13px] text-[var(--text)]">{skill.network.domains.join(', ')}</span>{inLanguage(skill.network.why, lang) ? ` (${inLanguage(skill.network.why, lang)})` : ''}</>
                : t('gallery.networkNone')}
            </p>
          ) : null}
          {/* a plugin someone made (a skill with a surface): its page reads the project; whether it may change it is the person's to say */}
          {skill.surface && installed ? (
            <div className="mt-2 rounded-[10px] border border-[var(--border)] px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[14px] font-medium text-[var(--text)]">{t('gallery.pluginWrites')}</span>
                <SettingsSwitch checked={Boolean(skill.writes)} label={t('gallery.pluginWrites')}
                  onChange={(on) => { patch((k) => { const { writes: _was, ...rest } = k; return on ? { ...rest, writes: true as const } : rest; }); void sourcesApi.setPluginWrites(skill.uid, on, projectId).catch(reload); }} />
              </div>
              <p className="mt-1 text-[13px] leading-[17px] text-[var(--text-muted)]">{t('gallery.pluginWritesNote')}</p>
            </div>
          ) : null}
          {/* one that brings a program, or an element put in the app itself: it runs on this computer once the person lets it */}
          {(skill.program || skill.inApp) && installed ? (
            <div className="mt-2 rounded-[10px] border border-[var(--border)] px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[14px] font-medium text-[var(--text)]">{t('gallery.pluginRuns')}</span>
                <SettingsSwitch checked={Boolean(skill.runs)} label={t('gallery.pluginRuns')}
                  onChange={(on) => { patch((k) => { const { runs: _was, ...rest } = k; return on ? { ...rest, runs: true as const } : rest; }); void sourcesApi.setPluginRuns(skill.uid, on, projectId).catch(reload); }} />
              </div>
              <p className="mt-1 text-[13px] leading-[17px] text-[var(--text-muted)]">{t('gallery.pluginRunsNote')}</p>
            </div>
          ) : null}
        </PageSection>
      ) : null}
      <div className="mt-5 flex flex-col gap-2">
        {onTry ? (
          <button type="button" onClick={() => consent.ask(skill, () => onTry(skill))} disabled={skill.off || skill.waits || Boolean(skill.revoked)} title={skill.off ? t('gallery.tryOff') : undefined}
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--primary)] text-[14.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-40"><MessageSquarePlus size={15} />{t('gallery.tryNow')}</button>
        ) : null}
        {/* OpenFilm's system skills are only turned off */}
        {skill.update && installed ? (
          <button type="button" onClick={update} disabled={working !== null}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border-strong)] text-[14.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50">
            <RefreshCw size={14} />{working === 'updating' ? t('gallery.updating') : t('gallery.update').replace('{version}', skill.update.version)}</button>
        ) : null}
        {skill.core ? null : !installed ? (
          <button type="button" onClick={() => consent.ask(skill, () => install(true))} disabled={working !== null || skill.elsewhere === true}
            className={onTry
              ? 'flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border-strong)] text-[14.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50'
              : 'flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--primary)] text-[14.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50'}><Plus size={15} />{t(working === 'installing' ? 'gallery.installing' : 'gallery.install')}</button>
        ) : (
          <button type="button" onClick={() => { if (skill.source === 'official') install(false); else setRemoving(true); }}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--bg-field)] text-[14.5px] text-[var(--text-muted)] transition hover:bg-[color-mix(in_srgb,var(--err)_14%,var(--bg-field))] hover:text-[var(--err)]">
            <Trash2 size={14} />{t(skill.source === 'official' ? 'gallery.uninstall' : 'gallery.remove')}
          </button>
        )}
      </div>
      {consent.dialog}
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
    return <img src={skill.cover} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="h-9 w-9 shrink-0 rounded-[9px] object-cover ring-1 ring-[var(--border)]" />;
  }
  const Mark = ICONS[skill.icon ?? ''] ?? Sparkles;
  const hue = HUES[skill.icon ?? ''] ?? 220;
  return (
    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]"
      style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `light-dark(hsl(${hue} 62% 40%), hsl(${hue} 80% 72%))`, boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
      <Mark size={17} strokeWidth={1.7} />
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
      <div title={o.from === 'made' ? undefined : o.address} className="mt-2 flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--text-faint)]">{icon}<span className="truncate">{text}</span></div>
      {/* added from an address, not from Discover: OpenFilm has not looked at it */}
      {o.from === 'link' ? <p className="mt-1 text-[13px] leading-[17px] text-[var(--text-muted)]">{t('gallery.unlisted')}</p> : null}
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
        style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `light-dark(hsl(${hue} 62% 40%), hsl(${hue} 80% 72%))`, boxShadow: `0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
        <Mark size={small ? 14 : big ? 28 : 24} strokeWidth={1.6} />
      </span>
      {/* a card has its title under it; the page's big picture carries it */}
      {big ? <span className="line-clamp-2 text-[22px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</span> : null}
    </div>
  );
}

/* characters a reader cannot see, which can hide words from them and not from an agent: zero-width ones, direction
   marks and overrides, the soft hyphen, the word joiner family, the byte-order mark */
const HIDDEN = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
/* what Markdown shows nobody: an HTML comment */
const COMMENT = /<!--[\s\S]*?-->/g;

/** A skill's text as it is, with what a reader would not see marked: each hidden character named, each comment lit. */
function Revealed({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let at = 0, n = 0;
  const marks = [...text.matchAll(new RegExp(`${COMMENT.source}|${HIDDEN.source}`, 'g'))];
  for (const m of marks) {
    if (m.index > at) parts.push(text.slice(at, m.index));
    const hidden = m[0].length === 1 && HIDDEN.test(m[0]);
    HIDDEN.lastIndex = 0;
    parts.push(hidden
      ? <mark key={n++} className="rounded-[3px] bg-[var(--warn)] px-0.5 text-[11px] text-black">U+{m[0].codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}</mark>
      : <mark key={n++} className="rounded-[3px] bg-[color-mix(in_srgb,var(--warn)_30%,transparent)] text-[var(--text)]">{m[0]}</mark>);
    at = m.index + m[0].length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * A skill a project brings, before it is let in: said plainly what letting it in means, its SKILL.md whole with hidden
 * characters and comments marked, its files with scripts marked, and one button that allows it in this project as it is.
 */
function ProjectSkillReview({ skill, projectId, onAllowed }: { skill: SkillEntry; projectId: string; onAllowed: () => void }) {
  const t = useT();
  const [read, setRead] = React.useState<{ text: string; files: Array<{ path: string; size: number }>; more: number } | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { let live = true; void sourcesApi.skillText(skill.uid, projectId).then((r) => { if (live) setRead(r); }, () => {}); return () => { live = false; }; }, [skill.uid, projectId]);
  const hidden = read ? [...read.text.matchAll(new RegExp(`${COMMENT.source}|${HIDDEN.source}`, 'g'))].length : 0;
  const script = (path: string) => !/\.(md|txt|json|jpe?g|png|webp|gif|svg|mp4|webm|mp3|m4a|wav)$/i.test(path);
  const allow = () => {
    setBusy(true);
    void sourcesApi.allowProjectSkill(skill.uid, projectId, true).then(onAllowed, () => {}).finally(() => setBusy(false));
  };
  return (
    <section className="mt-5 rounded-[12px] border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_7%,transparent)] p-4">
      <h3 className="text-[15px] font-semibold text-[var(--text)]">{t('gallery.projectSkillTitle')}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-muted)]">{t('gallery.projectSkillNote')}</p>
      {hidden ? <p role="alert" className="mt-2 text-[14px] font-medium text-[var(--warn)]">{t('gallery.projectSkillHidden').replace('{n}', String(hidden))}</p> : null}
      <pre className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-[var(--bg-field)] p-3 font-mono text-[12.5px] leading-[19px] text-[var(--text)]">
        {read ? <Revealed text={read.text || t('gallery.projectSkillNoText')} /> : '…'}
      </pre>
      {read?.files.length ? (
        <div className="mt-3">
          <div className="mb-1 text-[13px] text-[var(--text-faint)]">{t('gallery.projectSkillFiles')}</div>
          <ul className="flex flex-col gap-0.5 font-mono text-[12.5px] text-[var(--text-muted)]">
            {read.files.map((f) => (
              <li key={f.path} className="flex items-center gap-2">
                <span className="min-w-0 truncate">{f.path}</span>
                {script(f.path) ? <span className="shrink-0 rounded-[4px] bg-[color-mix(in_srgb,var(--warn)_25%,transparent)] px-1 font-sans text-[11px] text-[var(--text)]">{t('gallery.projectSkillScript')}</span> : null}
                <span className="ml-auto shrink-0 text-[var(--text-faint)]">{f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`}</span>
              </li>
            ))}
            {read.more ? <li className="text-[var(--text-faint)]">+{read.more}</li> : null}
          </ul>
        </div>
      ) : null}
      <button type="button" disabled={busy || !read} onClick={allow}
        className="mt-4 flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--primary)] px-4 text-[14.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50">
        {t('gallery.projectSkillAllow')}
      </button>
    </section>
  );
}

/**
 * Before one made by someone other than OpenFilm, that brings scripts, is installed: said plainly that its scripts run
 * on this computer with the agent's access, by whom it is made, and asked. `ask(skill, go)` runs `go` at once when there
 * is nothing to ask; `dialog` is put in the page.
 */
export function useScriptsConsent() {
  const t = useT();
  const [asking, setAsking] = React.useState<{ skill: SkillEntry; go: () => void } | null>(null);
  const ask = (skill: SkillEntry, go: () => void) => {
    if (skill.scripts > 0 && ownerOf(skill) !== 'openfilm') setAsking({ skill, go }); else go();
  };
  const dialog = (
    <ConfirmDialog open={asking != null}
      title={t('gallery.scriptsConsentTitle').replace('{maker}', asking ? makerOf(asking.skill) : '')}
      description={asking ? t('gallery.scriptsConsentNote').replace('{n}', String(asking.skill.scripts)) : ''}
      confirmLabel={t('gallery.scriptsConsentGo')}
      onCancel={() => setAsking(null)} onConfirm={() => { const go = asking?.go; setAsking(null); go?.(); }} />
  );
  return { ask, dialog };
}
