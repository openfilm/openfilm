/**
 * The Community's model leaderboard (lib/model-benchmark): which model makes films best. An OpenFilm film is a web
 * page, so Arena's WebDev board is the film board: its score, and what a task costs on each model, so the person can
 * find what is worth its price.
 *
 * Its own place: a head with the board's size and date; the top three as a podium; score against cost as a chart, the
 * value frontier joined by a line (no model scores higher for the same money); then every model in a table that is
 * searched, narrowed to a lab, sorted by rank, price or value. On the first page a panel with the top few.
 *
 * Colour follows the lab, the same on the podium, the chart and the table: the three labs with the most models a
 * colour each, the rest one grey (a scatter tells three apart at most); every coloured mark has its name beside it or
 * in its row, never colour alone.
 */
import * as React from 'react';
import { ArrowUpRight, BadgeDollarSign, Gauge, Search, Sparkles } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { COLOURED_LABS, rowKey, valueFrontier, WEBDEV_BENCHMARK, type BenchmarkRow } from '@/lib/model-benchmark';
import { Shelf } from './CommunityHome';
import { CommunityPageHead } from '../CommunityFrame';
import home from './CommunityHome.module.css';
import styles from './ModelBenchmark.module.css';

const ROWS: readonly BenchmarkRow[] = WEBDEV_BENCHMARK.rows;
const FRONTIER = valueFrontier(ROWS);
const rankOf = (row: BenchmarkRow) => ROWS.indexOf(row) + 1;
/** a lab's colour (one of three, or the shared grey) */
const labColour = (lab: string) => ((COLOURED_LABS as readonly string[]).includes(lab) ? `var(--lab-${lab.toLowerCase()})` : 'var(--lab-other)');

function useBoardWords() {
  const t = useT();
  const language = useLanguage();
  const fmt = (n: number) => n.toLocaleString(language);
  /* a task's cost to the cent; a price as it is quoted ($8, $3.75) */
  const money = (n: number | null) => (n == null ? t('communityHome.noCost') : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const price = (n: number | null) => (n == null ? t('communityHome.noCost') : `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`);
  const compact = (n: number) => new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const date = new Date(`${WEBDEV_BENCHMARK.date}T12:00:00Z`).toLocaleDateString(language, { year: 'numeric', month: 'long', day: 'numeric' });
  const shortDate = new Date(`${WEBDEV_BENCHMARK.date}T12:00:00Z`).toLocaleDateString(language, { month: 'short', day: 'numeric' });
  const lab = (name: string) => { const key = `communityHome.lab_${name}`; const said = t(key); return said === key ? name : said; };
  return { t, fmt, money, price, compact, date, shortDate, lab };
}

/** A lab's name with its colour beside it. */
function LabTag({ lab }: { lab: string }) {
  const { lab: name } = useBoardWords();
  return <span className={styles.labTag}><i style={{ background: labColour(lab) }} />{name(lab)}</span>;
}

/** Marked as one of the value frontier. */
function ValuePick() {
  const { t } = useBoardWords();
  return <span className={styles.valuePick}><Sparkles size={11} strokeWidth={2.2} aria-hidden />{t('communityHome.valuePick')}</span>;
}

/** The page's head: what the board is, how large and how new. */
function Head() {
  const { t, fmt, compact, date } = useBoardWords();
  return (
    <CommunityPageHead title={t('communityHome.benchmark')} note={t('communityHome.benchText2')} aside={(
      <dl className={styles.stats}>
        <div><dt>{t('communityHome.statModels').replace('{n}', '')}</dt><dd>{fmt(WEBDEV_BENCHMARK.models)}</dd></div>
        <div><dt>{t('communityHome.statVotes').replace('{n}', '')}</dt><dd>{compact(WEBDEV_BENCHMARK.votes)}</dd></div>
        <div><dt>{t('communityHome.statUpdated').replace('{date}', '')}</dt><dd className={styles.statDate}>{date}</dd></div>
      </dl>
    )} />
  );
}

/** The top three, the first raised. */
function Podium() {
  const { t, fmt, money, price } = useBoardWords();
  return (
    <div className={styles.podium}>
      {ROWS.slice(0, 3).map((row, i) => (
        <article key={rowKey(row)} className={styles.place} data-place={i + 1} style={{ '--lab': labColour(row.lab) } as React.CSSProperties}>
          <span className={styles.medal} aria-label={`#${i + 1}`}>{i + 1}</span>
          <div className={styles.placeName}><b>{row.name}</b>{row.variant ? <i>{row.variant}</i> : null}</div>
          <LabTag lab={row.lab} />
          <div className={styles.placeScore}>{fmt(row.score)}</div>
          <div className={styles.placeCost}>
            <span>{t('communityHome.podiumCost').replace('{cost}', money(row.cost))}</span>
            {row.price != null ? <span>{t('communityHome.podiumPrice').replace('{price}', price(row.price))}</span> : null}
          </div>
          {FRONTIER.has(rowKey(row)) ? <ValuePick /> : null}
        </article>
      ))}
    </div>
  );
}

/* the chart's scales: cost on a log scale from 2 cents to $16, score from 1,420 to 1,840 */
const COST = [0.02, 16] as const;
const SCORE = [1420, 1840] as const;
const COST_TICKS = [0.03, 0.1, 0.3, 1, 3, 10];
const SCORE_TICKS = [1500, 1600, 1700, 1800];
const xOf = (cost: number) => ((Math.log2(cost) - Math.log2(COST[0])) / (Math.log2(COST[1]) - Math.log2(COST[0]))) * 100;
const yOf = (score: number) => (1 - (score - SCORE[0]) / (SCORE[1] - SCORE[0])) * 100;
/* where a value pick's name goes beside its dot, so close ones do not cover each other */
const LABEL: Record<string, { side: 'left' | 'right'; dy: number }> = {
  'Claude Fable 5.2 · xHigh': { side: 'left', dy: -11 },
  'Claude Opus 5.5 · Max': { side: 'left', dy: 11 },
  'Claude Sonnet 5.5 · xHigh': { side: 'right', dy: -6 },
  'Gemini 4 Carbon · High': { side: 'left', dy: -9 },
  'GPT-6.2 Sol · Max': { side: 'left', dy: 7 },
  'Claude Sonnet 5.5 · High': { side: 'left', dy: 6 },
  'GPT-6.1 Terra · Max': { side: 'left', dy: 0 },
};

/** Score against cost: a dot per model in its lab's colour, the value frontier joined, the picks named. */
function ValueChart() {
  const { t, fmt, money, price, lab } = useBoardWords();
  const [hover, setHover] = React.useState<string | null>(null);
  const priced = ROWS.filter((row): row is BenchmarkRow & { cost: number } => row.cost != null);
  const frontier = priced.filter(row => FRONTIER.has(rowKey(row))).sort((a, b) => a.cost - b.cost);
  const shown = hover ? priced.find(row => rowKey(row) === hover) : undefined;
  const legend = [...COLOURED_LABS, 'other'] as const;
  return (
    <section className={styles.chartCard} aria-label={t('communityHome.chartTitle')}>
      <header className={styles.cardHead}>
        <div>
          <h2>{t('communityHome.chartTitle')}</h2>
          <p>{t('communityHome.chartNote')}</p>
        </div>
        <ul className={styles.legend}>
          {legend.map(name => <li key={name}><i style={{ background: name === 'other' ? 'var(--lab-other)' : labColour(name) }} />{name === 'other' ? t('communityHome.labOther') : lab(name)}</li>)}
          <li><span className={styles.legendLine} />{t('communityHome.valuePick')}</li>
        </ul>
      </header>
      <div className={styles.chart}>
        <div className={styles.yAxis} aria-hidden>
          {SCORE_TICKS.map(s => <span key={s} style={{ top: `${yOf(s)}%` }}>{fmt(s)}</span>)}
        </div>
        <div className={styles.plot} onMouseLeave={() => setHover(null)}>
          {SCORE_TICKS.map(s => <span key={s} className={styles.hGrid} style={{ top: `${yOf(s)}%` }} aria-hidden />)}
          {COST_TICKS.map(c => <span key={c} className={styles.vGrid} style={{ left: `${xOf(c)}%` }} aria-hidden />)}
          <svg className={styles.frontier} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polyline points={frontier.map(row => `${xOf(row.cost)},${yOf(row.score)}`).join(' ')} vectorEffect="non-scaling-stroke" />
          </svg>
          {priced.map(row => {
            const key = rowKey(row);
            const pick = FRONTIER.has(key);
            const label = LABEL[key] ?? { side: xOf(row.cost) > 75 ? 'left' : 'right', dy: 0 };
            return (
              <React.Fragment key={key}>
                <button type="button" className={styles.point} data-pick={pick || undefined} data-on={hover === key || undefined}
                  style={{ left: `${xOf(row.cost)}%`, top: `${yOf(row.score)}%`, background: labColour(row.lab) }}
                  aria-label={`${row.name} ${row.variant}: ${fmt(row.score)} · ${money(row.cost)}`}
                  onMouseEnter={() => setHover(key)} onFocus={() => setHover(key)} onBlur={() => setHover(null)} />
                {pick ? (
                  <span className={styles.pointLabel} data-side={label.side} aria-hidden
                    style={{ left: `${xOf(row.cost)}%`, top: `calc(${yOf(row.score)}% + ${label.dy}px)` }}>{row.name}{row.variant ? <em>{row.variant}</em> : null}</span>
                ) : null}
              </React.Fragment>
            );
          })}
          {shown ? (
            <div className={styles.tip} role="status" data-side={xOf(shown.cost) > 60 ? 'left' : 'right'}
              style={{ left: `${xOf(shown.cost)}%`, top: `${yOf(shown.score)}%` }}>
              <b>{shown.name} {shown.variant ? <em>{shown.variant}</em> : null}</b>
              <LabTag lab={shown.lab} />
              <dl>
                <dt>{t('communityHome.benchScore')}</dt><dd>{fmt(shown.score)}</dd>
                <dt>{t('communityHome.colCost')}</dt><dd>{money(shown.cost)}</dd>
                <dt>{t('communityHome.colPrice')}</dt><dd>{price(shown.price)}</dd>
                {shown.io ? <><dt>{t('communityHome.tipIO')}</dt><dd>{price(shown.io[0])} / {price(shown.io[1])}</dd></> : null}
              </dl>
            </div>
          ) : null}
        </div>
        <div className={styles.xAxis} aria-hidden>
          {COST_TICKS.map(c => <span key={c} style={{ left: `${xOf(c)}%` }}>${c}</span>)}
        </div>
        <span className={styles.axisName} aria-hidden>{t('communityHome.chartCostAxis')}</span>
      </div>
    </section>
  );
}

type Sort = 'rank' | 'cheap' | 'value';
const FIRST_ROWS = 30;

/** Every model: searched, narrowed to a lab, sorted; its score as a bar and its cost as one. */
function FullBoard() {
  const { t, fmt, money, price, lab } = useBoardWords();
  const [query, setQuery] = React.useState('');
  const [only, setOnly] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<Sort>('rank');
  const [picks, setPicks] = React.useState(false);
  const counts = new Map<string, number>();
  for (const row of ROWS) counts.set(row.lab, (counts.get(row.lab) ?? 0) + 1);
  const labs = [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  /* the first rows, then every one (the board is long) */
  const [all, setAll] = React.useState(false);
  const needle = query.trim().toLowerCase();
  const maxCost = Math.max(...ROWS.map(row => row.cost ?? 0));
  const [low, high] = [Math.min(...ROWS.map(r => r.score)) - 20, ROWS[0]!.score];
  const rows = ROWS.filter(row => (!only || row.lab === only) && (!picks || FRONTIER.has(rowKey(row)))
    && (!needle || `${row.name} ${row.variant} ${row.lab} ${lab(row.lab)}`.toLowerCase().includes(needle)))
    .sort((a, b) => sort === 'cheap' ? (a.cost ?? Infinity) - (b.cost ?? Infinity)
      : sort === 'value' ? Number(FRONTIER.has(rowKey(b))) - Number(FRONTIER.has(rowKey(a))) || b.score - a.score
        : rankOf(a) - rankOf(b));
  return (
    <section className={styles.boardCard} aria-label={t('communityHome.boardTitle')}>
      <header className={styles.boardTools}>
        <h2>{t('communityHome.boardTitle')}</h2>
        <label className={styles.find}>
          <Search size={14} strokeWidth={1.8} aria-hidden />
          <input type="search" value={query} placeholder={t('communityHome.searchModels')} aria-label={t('communityHome.searchModels')} onChange={e => setQuery(e.target.value)} />
        </label>
        <div className={styles.segment} role="radiogroup" aria-label={t('communityHome.sortRank')}>
          {(['rank', 'cheap', 'value'] as const).map(s => (
            <button key={s} type="button" role="radio" aria-checked={sort === s} onClick={() => setSort(s)}>
              {t(s === 'rank' ? 'communityHome.sortRank' : s === 'cheap' ? 'communityHome.sortCheap' : 'communityHome.sortValue')}
            </button>
          ))}
        </div>
      </header>
      <div className={styles.labRow}>
        {[null, ...labs].map(name => (
          <button key={name ?? ''} type="button" aria-pressed={only === name} onClick={() => setOnly(name)} className={styles.labPick}>
            {name ? <i style={{ background: labColour(name) }} /> : null}{name ? lab(name) : t('assetDrawer.allItems')}
          </button>
        ))}
        <button type="button" aria-pressed={picks} onClick={() => setPicks(p => !p)} className={`${styles.labPick} ${styles.picksToggle}`}>
          <Sparkles size={12} strokeWidth={2} aria-hidden />{t('communityHome.onlyValue')}
        </button>
      </div>
      <div role="table" aria-label={t('communityHome.boardTitle')} className={styles.table}>
        <div role="row" className={styles.tHead}>
          <span role="columnheader">#</span>
          <span role="columnheader">{t('communityHome.benchModel')}</span>
          <span role="columnheader">{t('communityHome.benchScore')}</span>
          <span role="columnheader">{t('communityHome.colCost')}</span>
          <span role="columnheader" className={styles.end}>{t('communityHome.colPrice')}</span>
        </div>
        {(all ? rows : rows.slice(0, FIRST_ROWS)).map(row => {
          const key = rowKey(row);
          const rank = rankOf(row);
          return (
            <div key={key} role="row" className={styles.tRow} data-model-row={key} style={{ '--lab': labColour(row.lab) } as React.CSSProperties}>
              <span role="cell" className={styles.rank} data-top={rank <= 3 ? rank : undefined}>{rank}</span>
              <span role="cell" className={styles.who}>
                <span className={styles.whoName}><b>{row.name}</b>{row.variant ? <i>{row.variant}</i> : null}{FRONTIER.has(key) ? <ValuePick /> : null}</span>
                <LabTag lab={row.lab} />
              </span>
              <span role="cell" className={styles.meter} aria-label={`${t('communityHome.benchScore')} ${fmt(row.score)}`}>
                <b>{fmt(row.score)}</b>
                <span><i style={{ width: `${((row.score - low) / (high - low)) * 100}%` }} /></span>
              </span>
              <span role="cell" className={styles.meter} data-kind="cost" aria-label={`${t('communityHome.colCost')} ${money(row.cost)}`}>
                <b data-none={row.cost == null || undefined}>{money(row.cost)}</b>
                <span>{row.cost != null ? <i style={{ width: `${(row.cost / maxCost) * 100}%` }} /> : null}</span>
              </span>
              <span role="cell" className={styles.price}>{price(row.price)}</span>
            </div>
          );
        })}
        {!rows.length ? <p className={styles.none}>{t('communityHome.noModels')}</p> : null}
        {rows.length > FIRST_ROWS ? (
          <button type="button" className={styles.more} onClick={() => setAll(a => !a)}>
            {all ? t('communityHome.showLess') : t('communityHome.showAll').replace('{n}', String(rows.length))}
          </button>
        ) : null}
      </div>
      <footer className={styles.boardFoot}>
        <span>{t('communityHome.shownOf').replace('{n}', String(ROWS.length)).replace('{total}', fmt(WEBDEV_BENCHMARK.models))}</span>
        <a href={WEBDEV_BENCHMARK.source} target="_blank" rel="noreferrer">{t('communityHome.fullBoard')}<ArrowUpRight size={13} aria-hidden /></a>
      </footer>
    </section>
  );
}

/** How to read it: the score, the cost, the value picks. */
function Tips() {
  const { t } = useBoardWords();
  const tips = [
    { key: 'score', icon: <Gauge size={18} strokeWidth={1.8} aria-hidden />, title: t('communityHome.tipScoreTitle'), text: t('communityHome.tipScore'), tone: 'blue' },
    { key: 'cost', icon: <BadgeDollarSign size={18} strokeWidth={1.8} aria-hidden />, title: t('communityHome.tipCostTitle'), text: t('communityHome.tipCost'), tone: 'amber' },
    { key: 'value', icon: <Sparkles size={18} strokeWidth={1.8} aria-hidden />, title: t('communityHome.tipValueTitle'), text: t('communityHome.tipValue'), tone: 'teal' },
  ];
  return (
    <div className={styles.tips}>
      {tips.map(tip => (
        <section key={tip.key} className={styles.tipCard} data-tone={tip.tone}>
          <span className={styles.tipIcon}>{tip.icon}</span>
          <h3>{tip.title}</h3>
          <p>{tip.text}</p>
        </section>
      ))}
    </div>
  );
}

/** The first page's panel: why this board, the top few with their cost, the way to all of it. */
export function BenchmarkPanel({ top = 6, onAll }: { top?: number; onAll: () => void }) {
  const { t, fmt, money, compact, shortDate } = useBoardWords();
  return (
    <Shelf title={t('communityHome.benchmark')} note={t('communityHome.benchSource').replace('{date}', shortDate)} all={onAll}>
      <div className={`${styles.labs} ${styles.panel}`} data-model-benchmark="">
        <div className={styles.panelIntro}>
          <span className={styles.eyebrow}>{t('communityHome.benchEyebrow')}</span>
          <h3>{t('communityHome.benchHeading')}</h3>
          <p>{t('communityHome.benchText2')}</p>
          <dl className={styles.miniStats}>
            <div><dd>{fmt(WEBDEV_BENCHMARK.models)}</dd><dt>{t('communityHome.statModels').replace('{n}', '').trim()}</dt></div>
            <div><dd>{compact(WEBDEV_BENCHMARK.votes)}</dd><dt>{t('communityHome.statVotes').replace('{n}', '').trim()}</dt></div>
          </dl>
          <button type="button" className={styles.allButton} onClick={onAll}>{t('communityHome.benchSeeAll')}<ArrowUpRight size={14} aria-hidden /></button>
        </div>
        <ol className={styles.panelRows}>
          {ROWS.slice(0, top).map(row => {
            const key = rowKey(row);
            return (
              <li key={key} style={{ '--lab': labColour(row.lab) } as React.CSSProperties}>
                <span className={styles.rank} data-top={rankOf(row) <= 3 ? rankOf(row) : undefined}>{rankOf(row)}</span>
                <span className={styles.who}>
                  <span className={styles.whoName}><b>{row.name}</b>{row.variant ? <i>{row.variant}</i> : null}{FRONTIER.has(key) ? <ValuePick /> : null}</span>
                  <LabTag lab={row.lab} />
                </span>
                <span className={styles.panelScore}>{fmt(row.score)}</span>
                <span className={styles.panelCost}><small>{t('communityHome.perTask')}</small>{money(row.cost)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </Shelf>
  );
}

/** Its own place. */
export function BenchmarkPage() {
  return (
    <div className={`${home.page} ${styles.labs}`} data-community-scroll="" data-model-benchmark-page="">
      <div className={home.column}>
        <Head />
        <Podium />
        <ValueChart />
        <FullBoard />
        <Tips />
      </div>
    </div>
  );
}
