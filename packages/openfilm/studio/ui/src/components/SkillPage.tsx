/**
 * A skill on its own, in the Community (library/PluginsPane) in place of its list, laid out as a store's product page:
 * its icon large beside its title, what it is for and who made it, and what to do (Get when it is not here, Try now: a
 * new conversation with the skill named in its message, an update, its switch: on, an agent takes it up whenever it
 * fits); a strip of facts (how many use it, the kind of work, who made it and how far that is vouched for, its version,
 * its scripts); then its preview (or cover), what it does, its profile, how to use it, what it may do on this computer
 * (its scripts; a plugin's leave to change the project and to run, the person's to give), what it is made of (folded,
 * for developers), and at the quiet end reporting it or uninstalling it (an official one) or moving it to the trash
 * (the person's own, a project's); OpenFilm's system skills are only turned off. Back returns to the list. Also here: a
 * skill's words in the language shown, its cover, and the parts a plugin's page (library/PluginsPane) is made of as well.
 */
import React from 'react';
import { AppIcon } from './AppIcon';
import {
  AudioLines, BadgeCheck, Clapperboard, Flag, Folder, GitBranch, Github, MessageSquarePlus, Palette, RefreshCw, Scissors, Shapes, Trash2, Wand2, Wrench, type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { usePlugins } from '@/lib/plugins';
import { isPlugin } from '@/lib/project-plugins';
import { communityOf, makerOf, ownerOf, sourcesApi, type SkillEntry } from '@/lib/project-sources';
import { categoryOfSkill, type Category } from '@/lib/plugin-profile';
import { ConfirmDialog } from './ConfirmDialog';
import { ProfileStrip } from './library/PluginProfile';
import { DocLines, DocOff, DocSection, DocSteps, sortDetails } from './library/DocSections';
import { SettingsSwitch } from './settings/ui';
import { DetailShell, Facts, PageButton } from './library/Store';

/** OpenFilm's own by their order, then the community's as Discover's index lists them (an author's own order is not theirs to set). */
/** `/owner/repo` of a GitHub address, said after its host; nothing for another site. */
function githubRepoOf(source: string): string {
  try {
    const url = new URL(source);
    return url.hostname === 'github.com' ? `/${url.pathname.split('/').filter(Boolean).slice(0, 2).join('/')}` : '';
  } catch { return ''; }
}

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

export function SkillPage({ skill, setSkills, projectId, onBack, onTry, onOn, onAuthor }: {
  skill: SkillEntry;
  /** the list it is in: each change shown there at once, then read again */
  setSkills: React.Dispatch<React.SetStateAction<SkillEntry[]>>;
  projectId: string | null;
  onBack: () => void;
  /** Try now (none: Studio without the app's chat) */
  onTry?: (skill: SkillEntry) => void;
  /** its maker's name opens their page in the Community (none: their GitHub) */
  onAuthor?: (owner: string) => void;
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
  /* a newer version that brings more (scripts, hosts, a page, a program): asked before it is taken */
  const [growing, setGrowing] = React.useState(false);
  const adds = skill.update?.adds;
  const addsText = adds ? [
    adds.scripts ? t('gallery.addsScripts').replace('{n}', String(adds.scripts)) : null,
    adds.network?.length ? t('gallery.addsNetwork').replace('{hosts}', adds.network.join(', ')) : null,
    adds.page ? t('gallery.addsPage') : null,
    adds.program ? t('gallery.addsProgram') : null,
    adds.element ? t('gallery.addsElement') : null,
  ].filter(Boolean).join(' ') : '';
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
  /* how many use it (anonymous counts, the community's): a fact of its strip when known */
  const [installs, setInstalls] = React.useState<number | null>(null);
  React.useEffect(() => { let live = true; void sourcesApi.communityStats().then((r) => { if (live) setInstalls(r[skill.uid]?.installs ?? null); }); return () => { live = false; }; }, [skill.uid]);
  const maker = communityOf(skill) ? makerOf(skill) : skill.source === 'official' ? 'OpenFilm' : t(group);
  const tryOff = skill.off || skill.waits || Boolean(skill.revoked);
  /* its source: OpenFilm's repository, or the address one of the person's came from */
  const sourceButton = source ? (
    <a href={source} target="_blank" rel="noreferrer" title={source} aria-label={t('gallery.viewSource')}
      className="grid h-8 w-8 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><Github size={15} strokeWidth={1.75} /></a>
  ) : null;

  const remover = !skill.core && installed ? (skill.source === 'official' ? () => install(false) : () => setRemoving(true)) : null;
  const actions = skill.core ? null : !installed ? (
    <>
      <PageButton kind="main" busy={working === 'installing'} onClick={() => consent.ask(skill, () => install(true))} disabled={working !== null || skill.elsewhere === true}>
        {working === 'installing' ? t('gallery.installing') : t('assetDrawer.get')}</PageButton>
      {sourceButton}
    </>
  ) : (
    <>
      {onTry ? <PageButton kind="main" onClick={() => consent.ask(skill, () => onTry(skill))} disabled={tryOff} title={skill.off ? t('gallery.tryOff') : undefined}>
        <MessageSquarePlus size={14} strokeWidth={1.8} />{t('gallery.tryNow')}</PageButton> : null}
      {skill.update ? (
        <PageButton busy={working === 'updating'} onClick={() => (skill.update?.adds ? setGrowing(true) : update())} disabled={working !== null}>
          <RefreshCw size={13} strokeWidth={1.8} />{working === 'updating' ? t('gallery.updating') : t('gallery.update').replace('{version}', skill.update.version)}</PageButton>
      ) : null}
      {/* on, an agent takes it up whenever it fits; turned off, never, until turned on again */}
      {!skill.waits && !skill.revoked ? <PageButton onClick={() => turn(Boolean(skill.off))}>{t(skill.off ? 'assetDrawer.manageOn' : 'assetDrawer.manageOff')}</PageButton> : null}
      {remover ? <PageButton kind="danger" onClick={remover}><Trash2 size={13} aria-hidden />{t(skill.source === 'official' ? 'assetDrawer.manageRemove' : 'gallery.remove')}</PageButton> : null}
      {sourceButton}
      <span className="ml-1 text-[13px] text-[var(--text-faint)]">{t(skill.off ? 'assetDrawer.stateOff' : 'assetDrawer.stateInstalled')}</span>
    </>
  );
  const byline = (
    <>
      {communityOf(skill) ? (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <a href={`https://github.com/${makerOf(skill)}`} target="_blank" rel="noreferrer"
            onClick={(e) => { if (onAuthor) { e.preventDefault(); onAuthor(ownerOf(skill)); } }}
            className="truncate text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline">{makerOf(skill)}</a>
          <TrustMark skill={skill} />
        </span>
      ) : skill.source === 'official' ? <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">OpenFilm<BadgeCheck size={13} strokeWidth={2} aria-hidden /></span>
        : <span className="text-[var(--text-muted)]">{t(group)}</span>}
      <span aria-hidden>·</span>
      <span>{t(`assetDrawer.skillCat_${categoryOfSkill(skill)}`)}</span>
      {installs ? <><span aria-hidden>·</span><span className="tabular-nums">{t('assetDrawer.installs').replace('{n}', installs.toLocaleString())}</span></> : null}
    </>
  );
  const notice = (
    <>
      {skill.off ? <p className="mt-4 text-[13.5px] text-[var(--text-muted)]">{skill.plugin ? t('gallery.skillOffPlugin').replace('{plugin}', inLanguage(plugins.find((p) => p.id === skill.plugin)?.title, lang) ?? skill.plugin) : t('gallery.skillOff')}</p> : null}
      {skill.retired ? <p className="mt-2 text-[13.5px] text-[var(--text-muted)]">{t('gallery.retired')}</p> : null}
      {error ? <p role="alert" className="mt-3 text-[13.5px] text-[var(--warn)]">{error}</p> : null}
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
    </>
  );
  /* its facts at the side, as an extension's page lists them */
  const aside = (
    <Facts title={t('assetDrawer.factsTitle')} items={[
      { key: 'category', name: t('assetDrawer.factCategory'), value: <span className="inline-flex items-center gap-1.5"><CategoryGlyph category={categoryOfSkill(skill)} />{t(`assetDrawer.skillCat_${categoryOfSkill(skill)}`)}</span> },
      { key: 'maker', name: t('assetDrawer.factMaker'), value: maker },
      installs ? { key: 'installs', name: t('assetDrawer.factInstalls'), value: installs.toLocaleString() } : null,
      skill.version ? { key: 'version', name: t('assetDrawer.factVersion'), value: <>v{skill.version}{skill.update ? <span className="block text-[12px] text-[var(--text-faint)]">{t('assetDrawer.factNewer').replace('{version}', skill.update.version)}</span> : null}</> } : null,
      !skill.core ? { key: 'scripts', name: t('assetDrawer.factScripts'), value: skill.scripts ? t(skill.scripts === 1 ? 'gallery.scriptsOne' : 'gallery.scriptsMany').replace('{n}', String(skill.scripts)) : t('assetDrawer.factScriptsNone') } : null,
      source ? { key: 'source', name: t('assetDrawer.factSource'), value: <a href={source} target="_blank" rel="noreferrer" className="break-all text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline">{hostOf(source)}{githubRepoOf(source)}</a> } : null,
    ]} />
  );
  return (
    <DetailShell onBack={onBack} data={{ 'data-skill-page': skill.uid }} title={words.title} summary={words.summary || undefined}
      icon={<AppIcon src={skill.appIcon} kind="skill" size={88} className="shadow-[0_8px_24px_rgba(0,0,0,0.18)]" />}
      byline={byline} actions={actions} notice={notice} aside={aside}
      /* one with no preview of its own: it at work in the conversation, from its own words */>
      {/* what it looks like: its preview, or its cover */}
      {skill.preview || skill.cover || skill.source === 'mine' ? (
        <PageBlock title={t('assetDrawer.sectionPreview')}>
          <div className="relative aspect-video w-full overflow-hidden rounded-[16px] bg-black ring-1 ring-[var(--border)]">
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
        </PageBlock>
      ) : null}

      {/* laid out as every editor's and connector's page: how it measures up, what it does, how to use it */}
      {skill.profile ? <div className="mt-8 first:mt-0"><ProfileStrip profile={skill.profile} /></div> : null}
      {(() => {
        const sorted = sortDetails(details ?? undefined);
        const steps = [...(installed ? [t(!plugin ? 'assetDrawer.howSkill' : skill.tab ? 'assetDrawer.howTab' : 'assetDrawer.howWorkbench')] : []), ...sorted.how];
        return <>
          {sorted.about.length || needs || (skill.elsewhere && skill.platforms) || skill.origin ? (
            <DocSection title={t('assetDrawer.docAbout')}>
              <Origin skill={skill} />
              <DocLines lines={sorted.about} />
              {/* the computers it runs on, when this one is not among them; what it needs beyond OpenFilm */}
              {skill.elsewhere && skill.platforms ? (
                <p role="note" className="mt-2.5 text-[14px] leading-[20px] text-[var(--warn)]">
                  {t('gallery.onlyOn').replace('{where}', skill.platforms.map((p) => t(`gallery.platform_${p}`)).join(' / '))}</p>
              ) : null}
              {needs ? <p className="mt-2.5 text-[14px] leading-[20px] text-[var(--text-muted)]"><span className="font-medium text-[var(--text)]">{t('gallery.needs')}</span> {needs}</p> : null}
            </DocSection>
          ) : null}
          {steps.length ? <DocSection title={t('assetDrawer.connectorHow')}><DocSteps steps={steps} /></DocSection> : null}
          {sorted.off ? <DocOff text={sorted.off} /> : null}
        </>;
      })()}

      {(skill.scripts > 0 && !skill.core) || ((skill.surface || skill.program || skill.inApp) && installed) ? (
        <DocSection title={t('assetDrawer.pluginMay')}>
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
            <div className="mt-3 rounded-[12px] bg-[var(--bg-field)] px-4 py-3">
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
            <div className="mt-3 rounded-[12px] bg-[var(--bg-field)] px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[14px] font-medium text-[var(--text)]">{t('gallery.pluginRuns')}</span>
                <SettingsSwitch checked={Boolean(skill.runs)} label={t('gallery.pluginRuns')}
                  onChange={(on) => { patch((k) => { const { runs: _was, ...rest } = k; return on ? { ...rest, runs: true as const } : rest; }); void sourcesApi.setPluginRuns(skill.uid, on, projectId).catch(reload); }} />
              </div>
              <p className="mt-1 text-[13px] leading-[17px] text-[var(--text-muted)]">{t('gallery.pluginRunsNote')}</p>
            </div>
          ) : null}
        </DocSection>
      ) : null}

      {/* the quiet end: reporting one from the community */}
      {ownerOf(skill) !== 'openfilm' && skill.source !== 'mine' && skill.source !== 'project' ? (
        <div className="mt-6">
          <a href={`https://github.com/openfilm/community/issues/new?template=report.yml&title=${encodeURIComponent(`Report ${skill.uid}`)}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13.5px] text-[var(--text-faint)] transition hover:text-[var(--text)]">
            <Flag size={13} aria-hidden />{t('gallery.report')}
          </a>
        </div>
      ) : null}
      {consent.dialog}
      <ConfirmDialog open={growing} title={t('gallery.addsTitle').replace('{version}', skill.update?.version ?? '')}
        description={`${addsText} ${t('gallery.addsNote')}`} confirmLabel={t('gallery.addsGo')}
        onCancel={() => setGrowing(false)} onConfirm={() => { setGrowing(false); update(); }} />
      <ConfirmDialog open={removing} danger
        title={t('gallery.removeTitle').replace('{name}', words.title)}
        description={t('gallery.removeHint')} confirmLabel={t('gallery.remove')}
        onCancel={() => setRemoving(false)} onConfirm={remove} />
    </DetailShell>
  );
}



/** A part of the product page: its head large, a rule above it, what is under it. */
function PageBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="mb-3 text-[19px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h3>
      {children}
    </section>
  );
}

/** The kind of work it helps with, as the facts' line mark. */
function CategoryGlyph({ category }: { category: Category }) {
  const Mark = CATEGORY_MARKS[category] ?? Wand2;
  return <span className="flex justify-center"><Mark size={22} strokeWidth={1.6} aria-hidden /></span>;
}
const CATEGORY_MARKS: Record<string, LucideIcon> = { tool: Wrench, recipe: Clapperboard, sound: AudioLines, picture: Palette, edit: Scissors, material: Shapes };

/** A skill's mark at the start of its line in a list: its cover, else its icon in its own color. */
export function SkillMark({ skill, size = 36 }: { skill: Pick<SkillEntry, 'appIcon'>; size?: number }) {
  return <AppIcon src={skill.appIcon} kind="skill" size={size} />;
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

/** A skill's picture: its cover, else its preview's first frame, else its app icon large. */
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
  return (
    <div aria-label={title} className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg-field)] px-6 text-center">
      <AppIcon src={skill.appIcon} kind="skill" size={small ? 28 : big ? 72 : 56} />
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
  /* anything another community index lists (not reviewed by OpenFilm) asks always; else one with scripts, not OpenFilm's */
  const ask = (skill: SkillEntry, go: () => void) => {
    if (skill.from || (skill.scripts > 0 && ownerOf(skill) !== 'openfilm')) setAsking({ skill, go }); else go();
  };
  const unofficial = asking?.skill.from;
  const scriptsNote = asking && asking.skill.scripts > 0 ? t('gallery.scriptsConsentNote').replace('{n}', String(asking.skill.scripts)) : '';
  const dialog = (
    <ConfirmDialog open={asking != null}
      title={t(unofficial ? 'gallery.unofficialTitle' : 'gallery.scriptsConsentTitle').replace('{maker}', asking ? makerOf(asking.skill) : '')}
      description={unofficial ? `${t('gallery.unofficialNote').replace('{host}', hostOf(unofficial))}${scriptsNote ? ` ${scriptsNote}` : ''}` : scriptsNote}
      confirmLabel={t('gallery.scriptsConsentGo')}
      onCancel={() => setAsking(null)} onConfirm={() => { const go = asking?.go; setAsking(null); go?.(); }} />
  );
  return { ask, dialog };
}

/** Where an index is, as a person reads it: its host, or the file's name. */
export const hostOf = (address: string) => { try { return new URL(address).host; } catch { return address.split('/').pop() ?? address; } };

/**
 * How far a community item is vouched for, as a small mark: OpenFilm's own; listed by OpenFilm's community (reviewed: its
 * checks and AI review read every version); or listed by another index the person added (not reviewed). None for the
 * person's own or a project's.
 */
export function TrustMark({ skill }: { skill: SkillEntry }) {
  const t = useT();
  if (skill.source !== 'official' || skill.core) return null;
  const [word, tone] = ownerOf(skill) === 'openfilm' ? [t('gallery.trustOfficial'), 'var(--accent)']
    : skill.from ? [`${t('gallery.trustUnreviewed')} · ${hostOf(skill.from)}`, 'var(--warn)'] : [t('gallery.trustReviewed'), 'var(--ok)'];
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11.5px] font-medium"
      style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>{word}</span>
  );
}
