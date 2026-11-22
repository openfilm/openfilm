/**
 * The Community's first page as the desktop sidebar shows it (components/CommunityFrame), laid out as a community of
 * makers' work is browsed: a banner of what is put forward this week (a strip of pictures that moves on by itself,
 * with the way to step it and stop it), the places as chips (the frame's), then shelves in the order of those chips:
 * tutorials, films, what a maintainer picked, skills and plugins as lists, the model leaderboard, templates, three
 * large panels for the kinds of things, the makers, and the way to publish.
 *
 * Its things come from library/PluginsPane, already drawn as the store draws them (cards, rows, their buttons): this
 * file lays them out and draws what is its own (the banner, the films, the tutorials, the panels, the makers).
 */
import * as React from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, Bot, ChevronRight, Clapperboard, Film, Pause, Play, Rocket, SquareTerminal, Upload, type LucideIcon } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { TUTORIALS, tutorialUrl, type Tutorial } from '@/lib/community-tutorials';
import { makerName, byOpenFilm } from '@/lib/library';
import type { Example } from '@/lib/project-sources';
import { useSidePageLead } from '../SidePage';
import { CommunityPageHead } from '../CommunityFrame';
import { BenchmarkPanel } from './ModelBenchmark';
import styles from './CommunityHome.module.css';

export interface HeroTile { key: string; label: string; picture: React.ReactNode; onOpen: () => void }
export interface PanelPlugin { key: string; title: string; mark: React.ReactNode }

/** A shelf's head: its name, the way to all of it in the name itself, a word after it. */
export function Shelf({ title, note, all, children }: { title: string; note?: string | undefined; all?: (() => void) | undefined; children: React.ReactNode }) {
  return (
    <section className={styles.shelf} data-community-shelf={title}>
      <header>
        <h2>{all ? <button type="button" onClick={all}>{title}<ChevronRight size={15} strokeWidth={2} aria-hidden /></button> : title}</h2>
        {note ? <p>{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** A colour of someone's own, the same every time: a hue from their name. */
const hueOf = (name: string): number => {
  let hash = 0;
  for (const c of makerName(name)) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash % 360;
};

/** Someone's mark: the first letter of their name on a colour of their own; OpenFilm's, its letter on black. */
export function MakerMark({ name, size = 16 }: { name: string; size?: number }) {
  const official = byOpenFilm(name);
  const shown = makerName(name);
  const hue = hueOf(name);
  return (
    <span aria-hidden className={styles.maker} style={{ width: size, height: size, fontSize: Math.round(size * 0.5),
      ...(official ? { background: '#0f0f0f', color: '#fff', boxShadow: 'inset 0 0 0 1px #3a3a3a' } : { background: `oklch(0.62 0.13 ${hue})`, color: '#fff' }) }}>
      {official ? 'F' : shown.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Whose it is, as a card's foot says it: their mark, their name, OpenFilm's tick. */
export function Byline({ owner }: { owner?: string | undefined }) {
  if (!owner) return null;
  return (
    <span className={styles.byline}>
      <MakerMark name={owner} />
      <span className={styles.ellipsis}>{makerName(owner)}</span>
      {byOpenFilm(owner) ? <BadgeCheck size={12} strokeWidth={2} aria-label="OpenFilm" className={styles.tick} /> : null}
    </span>
  );
}

/** The week's banner: what it says at the left, the strip of pictures at the right, stepped by itself until stopped. */
function Hero({ tiles }: { tiles: readonly HeroTile[] }) {
  const t = useT();
  const [at, setAt] = React.useState(0);
  const [paused, setPaused] = React.useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hover, setHover] = React.useState(false);
  const last = Math.max(0, tiles.length - 3);
  React.useEffect(() => {
    if (paused || hover || last === 0) return undefined;
    const timer = window.setInterval(() => setAt(i => (i >= last ? 0 : i + 1)), 4500);
    return () => window.clearInterval(timer);
  }, [paused, hover, last]);
  const step = (by: number) => setAt(i => (i + by < 0 ? last : i + by > last ? 0 : i + by));
  return (
    <section className={styles.hero} aria-label={t('communityHome.heroEyebrow')} data-community-hero=""
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className={styles.heroText}>
        <span className={styles.eyebrow}>{t('communityHome.heroEyebrow')}</span>
        <h1>{t('communityHome.heroTitle')}</h1>
        <p>{t('communityHome.heroText')}</p>
        {tiles.length > 3 ? (
          <div className={styles.heroSteps}>
            <button type="button" aria-label={t('communityHome.heroPrev')} title={t('communityHome.heroPrev')} onClick={() => step(-1)}><ArrowLeft size={14} strokeWidth={2} aria-hidden /></button>
            <button type="button" aria-label={t('communityHome.heroNext')} title={t('communityHome.heroNext')} onClick={() => step(1)}><ArrowRight size={14} strokeWidth={2} aria-hidden /></button>
            <button type="button" aria-label={t(paused ? 'communityHome.heroPlay' : 'communityHome.heroPause')} title={t(paused ? 'communityHome.heroPlay' : 'communityHome.heroPause')}
              aria-pressed={paused} onClick={() => setPaused(p => !p)}>
              {paused ? <Play size={12} fill="currentColor" aria-hidden /> : <Pause size={12} fill="currentColor" aria-hidden />}
            </button>
          </div>
        ) : null}
      </div>
      <div className={styles.heroStrip}>
        <div className={styles.heroTrack} style={{ transform: `translateX(calc(${-at} * (var(--tile) + 14px)))` }}>
          {tiles.map(tile => (
            <button key={tile.key} type="button" className={styles.heroTile} aria-label={tile.label} title={tile.label} onClick={tile.onOpen}>
              <span className={styles.fill}>{tile.picture}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** How long a film is, as m:ss. */
const lengthOf = (seconds: number | null): string | null => (seconds ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : null);

/** An example film: its poster large, its preview playing over it while pointed at; its name and whose it is under it. */
export function FilmCard({ film, kind, onOpen }: { film: Example; kind: string; onOpen: () => void }) {
  const [hover, setHover] = React.useState(false);
  const length = lengthOf(film.duration);
  return (
    <button type="button" className={styles.film} onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      data-community-example={film.id} title={film.description || undefined}>
      <span className={styles.filmFrame}>
        <span className={styles.art}>
          {film.poster ? <img src={film.poster} alt="" loading="lazy" draggable={false} /> : null}
          {hover && film.video ? <video src={film.video} autoPlay muted loop playsInline /> : null}
        </span>
        {length ? <span className={styles.length}>{length}</span> : null}
      </span>
      <span className={styles.caption}>
        <span className={styles.title}>{film.title}</span>
        <span className={styles.meta}><Byline owner={film.owner} /><span aria-hidden>·</span><span className={styles.ellipsis}>{kind}</span></span>
      </span>
    </button>
  );
}

/** A tutorial: its picture (its number and a sketch of the app, in its colour), its name, how far in it goes. */
/* each tutorial's mark on its picture */
const TUTORIAL_ICON: Record<Tutorial['id'], LucideIcon> = { quickstart: Rocket, intro: Clapperboard, studio: Film, manual: Bot, cli: SquareTerminal };

/** A tutorial: its picture (its mark on a stage of its colour), its title, how far along it is. */
export function TutorialCard({ tutorial }: { tutorial: Tutorial }) {
  const t = useT();
  const language = useLanguage();
  const index = TUTORIALS.indexOf(tutorial) + 1;
  const accent = tutorial.accent;
  const Icon = TUTORIAL_ICON[tutorial.id];
  return (
    <a className={styles.tutorial} href={tutorialUrl(tutorial, language)} target="_blank" rel="noreferrer" data-community-tutorial={tutorial.id}>
      <span className={styles.tutorialFrame}>
        <span className={styles.cover} style={{ '--accent': accent } as React.CSSProperties} aria-hidden>
          <span className={styles.coverRings} />
          <span className={styles.coverTile}><Icon size={28} strokeWidth={1.8} /></span>
          <span className={styles.coverNum}>{String(index).padStart(2, '0')}</span>
        </span>
      </span>
      <span className={styles.caption}>
        <span className={styles.title}>{t(`communityHome.tutorial_${tutorial.id}_title`)}</span>
        <span className={styles.meta}>
          <span className={styles.level}>{t(tutorial.level === 'start' ? 'communityHome.levelStart' : 'communityHome.levelAdvanced')}</span>
          <span>{t('communityHome.tutorialKind')}</span><span aria-hidden>·</span><span>openfilm.dev</span>
        </span>
      </span>
    </a>
  );
}

/** Someone who shares their work: their mark large, their name, how many things of theirs are here, the way to them. */
export function CreatorCard({ name, count, onOpen }: { name: string; count: number; onOpen: () => void }) {
  const t = useT();
  return (
    <div className={styles.creator} data-community-creator={name} style={{ '--hue': hueOf(name) } as React.CSSProperties}>
      <span className={styles.creatorBanner} aria-hidden />
      <span className={styles.creatorMark}><MakerMark name={name} size={52} /></span>
      <span className={styles.creatorName}>{makerName(name)}{byOpenFilm(name) ? <BadgeCheck size={13} strokeWidth={2} aria-label="OpenFilm" className={styles.tick} /> : null}</span>
      {count ? <span className={styles.creatorCount}>{t('communityHome.creatorWorks').replace('{n}', count.toLocaleString())}</span> : null}
      <button type="button" className={styles.ghost} onClick={onOpen}>{t('communityHome.creatorOpen')}</button>
    </div>
  );
}

/** The three large panels: the library's things (some of its stickers), music and sound (one track), the editors. */
function CategoryPanels({ stickers, track, plugins, onAssets, onMusic, onPlugins }: {
  stickers: readonly React.ReactNode[]; track: { title: string; by: string } | null; plugins: readonly PanelPlugin[];
  onAssets: () => void; onMusic: () => void; onPlugins: () => void;
}) {
  const t = useT();
  const half = Math.ceil(stickers.length / 2);
  return (
    <div className={styles.panels}>
      <button type="button" className={`${styles.panel} ${styles.panelAssets}`} onClick={onAssets}>
        <span className={styles.panelTitle}>{t('communityHome.catAssets')}</span>
        <span className={styles.panelNote}>{t('communityHome.catAssetsNote')}</span>
        <span className={styles.stickers} aria-hidden>
          <span>{stickers.slice(0, half).map((s, i) => <span key={i} className={styles.sticker}>{s}</span>)}</span>
          <span>{stickers.slice(half).map((s, i) => <span key={i} className={styles.sticker}>{s}</span>)}</span>
        </span>
      </button>
      <button type="button" className={`${styles.panel} ${styles.panelMusic}`} onClick={onMusic}>
        <span className={styles.panelTitle}>{t('communityHome.catMusic')}</span>
        <span className={styles.panelNote}>{t('communityHome.catMusicNote')}</span>
        <span className={styles.trackBack} aria-hidden />
        <span className={styles.track} aria-hidden>
          <span className={styles.trackHead}>
            <span className={styles.trackPlay}><Play size={12} fill="currentColor" /></span>
            <span><b>{track?.title ?? t('communityHome.music')}</b><small>{track?.by ?? 'OpenFilm'}</small></span>
          </span>
          <span className={styles.wave}>{WAVE.map((h, i) => <i key={i} style={{ height: h }} data-played={i < 12 || undefined} />)}</span>
        </span>
      </button>
      <button type="button" className={`${styles.panel} ${styles.panelPlugins}`} onClick={onPlugins}>
        <span className={styles.panelTitle}>{t('communityHome.catPlugins')}</span>
        <span className={styles.panelNote}>{t('communityHome.catPluginsNote')}</span>
        <span className={styles.pills} aria-hidden>
          <span>{plugins.slice(0, 3).map(p => <span key={p.key} className={styles.pill}>{p.mark}{p.title}</span>)}</span>
          <span>{plugins.slice(3, 6).map(p => <span key={p.key} className={styles.pill}>{p.mark}{p.title}</span>)}</span>
        </span>
      </button>
    </div>
  );
}
/* a sound's shape, drawn the same every time (the panel stands for music, it plays nothing) */
const WAVE = [6, 10, 16, 12, 22, 18, 26, 14, 9, 20, 24, 12, 18, 26, 16, 10, 22, 14, 8, 18, 24, 12, 16, 22, 10, 6, 14, 20, 12, 8, 16, 10, 6, 4];

/** The way to publish, at the page's foot. */
function PublishBand({ onPublish }: { onPublish: () => void }) {
  const t = useT();
  return (
    <section className={styles.publish}>
      <span className={styles.publishMark}><Upload size={18} strokeWidth={1.8} aria-hidden /></span>
      <span className={styles.publishText}><b>{t('communityHome.publishTitle')}</b><small>{t('communityHome.publishText')}</small></span>
      <button type="button" className={styles.primary} onClick={onPublish}>{t('communityHome.publish')}</button>
    </section>
  );
}

export function CommunityHome({ searching, status, heroTiles, films, filmKind, onFilm, onFilms, picked, skills, onSkills, plugins, onPlugins,
  templates, onTemplates, stickers, track, panelPlugins, onAssets, onMusic, makers, onMaker, onMakers, onTutorials, onBenchmark, onPublish, results }: {
  /** words were typed in the search: what matches, without the banner and the panels */
  searching: boolean;
  status?: React.ReactNode;
  heroTiles: readonly HeroTile[];
  films: readonly Example[]; filmKind: (film: Example) => string; onFilm: (film: Example) => void; onFilms: () => void;
  /** the shelves a maintainer picked, each its name, its word and its cards */
  picked: ReadonlyArray<{ id: string; title: string; note?: string | undefined; cards: React.ReactNode[] }>;
  skills: readonly React.ReactNode[]; onSkills: () => void;
  plugins: readonly React.ReactNode[]; onPlugins: () => void;
  templates: readonly React.ReactNode[]; onTemplates: () => void;
  stickers: readonly React.ReactNode[]; track: { title: string; by: string } | null; panelPlugins: readonly PanelPlugin[];
  onAssets: () => void; onMusic: () => void;
  makers: ReadonlyArray<{ name: string; count: number }>; onMaker: (name: string) => void; onMakers: () => void;
  onTutorials: () => void; onBenchmark: () => void; onPublish: () => void;
  /** anything else that matched the words typed (packs, things of the library) */
  results?: React.ReactNode;
}) {
  const t = useT();
  const lead = useSidePageLead();
  return (
    <div className={styles.page} data-community-scroll="" data-community-home="">
      <div className={styles.column}>
        {!searching && heroTiles.length ? <Hero tiles={heroTiles} /> : null}
        {lead}
        {status}
        {!searching ? (
          <Shelf title={t('communityHome.tutorials')} all={onTutorials}>
            <div className={styles.gridTutorials}>{TUTORIALS.map(tutorial => <TutorialCard key={tutorial.id} tutorial={tutorial} />)}</div>
          </Shelf>
        ) : null}
        {films.length ? (
          <Shelf title={t('communityHome.films')} all={onFilms}>
            <div className={styles.gridFilms}>{films.map(film => <FilmCard key={film.id} film={film} kind={filmKind(film)} onOpen={() => onFilm(film)} />)}</div>
          </Shelf>
        ) : null}
        {picked.map(shelf => (
          <Shelf key={shelf.id} title={shelf.title} note={shelf.note}>
            <div className={styles.gridCards} data-featured-shelf={shelf.id}>{shelf.cards}</div>
          </Shelf>
        ))}
        {skills.length ? <Shelf title={t('assetDrawer.tab_skills')} all={onSkills}><div className={styles.gridRows}>{skills}</div></Shelf> : null}
        {plugins.length ? <Shelf title={t('assetDrawer.tab_plugins')} all={onPlugins}><div className={styles.gridRows}>{plugins}</div></Shelf> : null}
        {templates.length ? <Shelf title={t('communityHome.templates')} all={onTemplates}><div className={styles.gridCards}>{templates}</div></Shelf> : null}
        {results}
        {!searching ? (
          <Shelf title={t('communityHome.featuredCategories')}>
            <CategoryPanels stickers={stickers} track={track} plugins={panelPlugins} onAssets={onAssets} onMusic={onMusic} onPlugins={onPlugins} />
          </Shelf>
        ) : null}
        {!searching && makers.length ? (
          <Shelf title={t('communityHome.creators')} all={onMakers}>
            <div className={styles.gridCreators}>{makers.map(m => <CreatorCard key={m.name} name={m.name} count={m.count} onOpen={() => onMaker(m.name)} />)}</div>
          </Shelf>
        ) : null}
        {/* the model leaderboard last, as its chip is */}
        {!searching ? <BenchmarkPanel top={6} onAll={onBenchmark} /> : null}
        {!searching ? <PublishBand onPublish={onPublish} /> : null}
      </div>
    </div>
  );
}

/** The Tutorials place: every tutorial, larger. */
export function TutorialsPage() {
  const t = useT();
  return (
    <div className={styles.page} data-community-scroll="" data-community-tutorials="">
      <div className={styles.column}>
        <CommunityPageHead title={t('communityHome.tutorials')} note={t('communityHome.tutorialsNote')} />
        <div className={styles.gridTutorialsWide}>{TUTORIALS.map(tutorial => <TutorialCard key={tutorial.id} tutorial={tutorial} />)}</div>
      </div>
    </div>
  );
}

/** The Creators place: everyone with work here, the most first. */
export function CreatorsPage({ makers, onMaker }: { makers: ReadonlyArray<{ name: string; count: number }>; onMaker: (name: string) => void }) {
  const t = useT();
  return (
    <div className={styles.page} data-community-scroll="" data-community-creators="">
      <div className={styles.column}>
        <CommunityPageHead title={t('communityHome.creators')} note={t('communityHome.creatorsNote')} />
        <div className={styles.gridCreators}>{makers.map(m => <CreatorCard key={m.name} name={m.name} count={m.count} onOpen={() => onMaker(m.name)} />)}</div>
      </div>
    </div>
  );
}
