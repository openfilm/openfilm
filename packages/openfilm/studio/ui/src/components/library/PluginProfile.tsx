/**
 * A plugin's or a skill's profile as its page shows it at the top, the way a model's page sums a model up: a strip of
 * a few measures, each a mark to read at a glance and its word under it (how hard it is to start with, as dots; how
 * little work a result takes, as bolts; whether it costs money; how it is used, the ways it has lit and the others
 * dim), and who it is for across the foot; a measure it has nothing for is left out. Also its category, as a tag and as
 * the head of its part of the list.
 */
import React from 'react';
import {
  AppWindow, AudioLines, BookOpen, Coins, ImagePlus, MessageSquare, Scissors, SquareTerminal, SwatchBook, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import type { Category, Profile, Use } from '@/lib/plugin-profile';
import { USES } from '@/lib/plugin-profile';
import { inLanguage } from '../SkillPage';

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  material: ImagePlus, edit: Scissors, picture: SwatchBook, sound: AudioLines, recipe: BookOpen, tool: Wrench,
};
const USE_ICONS: Record<Use, LucideIcon> = { surface: AppWindow, chat: MessageSquare, commands: SquareTerminal };

/** Its category, as a small tag: its mark and its name. */
export function CategoryTag({ category }: { category: Category }) {
  const t = useT();
  const Mark = CATEGORY_ICONS[category];
  return (
    <span data-category={category} className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] bg-[var(--bg-field)] px-1.5 text-[11px] font-medium leading-none text-[var(--text-muted)]">
      <Mark size={11} strokeWidth={2} aria-hidden />{t(`assetDrawer.category_${category}`)}
    </span>
  );
}

/** A measure of five, as marks: so many lit, the rest dim. */
function Meter({ value, mark }: { value: number; mark: 'dot' | 'bolt' }) {
  return (
    <span aria-hidden className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => (mark === 'dot'
        ? <span key={i} className={`h-[9px] w-[9px] rounded-full ${i < value ? 'bg-[var(--text)]' : 'bg-[var(--border-strong)]'}`} />
        : <Zap key={i} size={14} strokeWidth={0} fill="currentColor" className={i < value ? 'text-[var(--text)]' : 'text-[var(--border-strong)]'} />))}
    </span>
  );
}

/** One measure of the strip: its name over it (what it means under the pointer), its marks, its word. */
function Cell({ name, tip, children, word }: { name: string; tip: string; children: React.ReactNode; word: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 px-2 py-3 text-center" title={tip}>
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-faint)]">{name}</span>
      <span className="flex h-[18px] items-center">{children}</span>
      <span className="text-[12px] leading-[16px] text-[var(--text)]">{word}</span>
    </div>
  );
}

/**
 * The strip: the measures its profile has, and how it is used (`uses`); who it is for across its foot. A thing with
 * no profile shows how it is used only.
 */
export function ProfileStrip({ profile, uses }: { profile: Profile | undefined; uses: readonly Use[] }) {
  const t = useT();
  const lang = useLanguage();
  const audience = inLanguage(profile?.audience, lang);
  const cells: React.ReactNode[] = [];
  if (profile?.difficulty) {
    cells.push(
      <Cell key="difficulty" name={t('assetDrawer.metric_difficulty')} tip={t('assetDrawer.metricTip_difficulty')} word={t(`assetDrawer.difficulty_${profile.difficulty}`)}>
        <Meter value={profile.difficulty} mark="dot" />
      </Cell>,
    );
  }
  if (profile?.ease) {
    cells.push(
      <Cell key="ease" name={t('assetDrawer.metric_ease')} tip={t('assetDrawer.metricTip_ease')} word={t(`assetDrawer.ease_${profile.ease}`)}>
        <Meter value={profile.ease} mark="bolt" />
      </Cell>,
    );
  }
  if (profile?.cost) {
    cells.push(
      <Cell key="cost" name={t('assetDrawer.metric_cost')} tip={t('assetDrawer.metricTip_cost')} word={t(`assetDrawer.costNote_${profile.cost}`)}>
        <span className="flex items-center gap-1 text-[15px] font-semibold leading-none text-[var(--text)]">
          {profile.cost === 'generation' ? <Coins size={14} strokeWidth={2} aria-hidden className="text-[var(--text-muted)]" /> : null}
          {t(`assetDrawer.cost_${profile.cost}`)}
        </span>
      </Cell>,
    );
  }
  if (uses.length) cells.push(
    <Cell key="uses" name={t('assetDrawer.metric_uses')} tip={t('assetDrawer.metricTip_uses')}
      word={uses.map((u, i) => <React.Fragment key={u}>{i ? t('assetDrawer.listSep') : null}<span className="whitespace-nowrap">{t(`assetDrawer.use_${u}`)}</span></React.Fragment>)}>
      <span className="flex items-center gap-1.5">
        {USES.map((u) => {
          const Mark = USE_ICONS[u];
          const has = uses.includes(u);
          return (
            <span key={u} role="img" aria-label={`${t(`assetDrawer.use_${u}`)}${has ? '' : ` ${t('assetDrawer.useNone')}`}`}
              className={`flex h-[18px] w-[18px] items-center justify-center rounded-[4px] ${has ? 'text-[var(--text)] ring-1 ring-[var(--text-muted)]' : 'text-[var(--border-strong)] ring-1 ring-[var(--border)]'}`}>
              <Mark size={11} strokeWidth={2} aria-hidden />
            </span>
          );
        })}
      </span>
    </Cell>,
  );
  /* nothing to say (one still being made, with no profile yet): no strip */
  if (!cells.length && !audience) return null;
  return (
    <div data-profile-strip="" className="@container mt-4 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--border)]">
      {/* the measures side by side, ruled apart by the gap between them; two to a row where the drawer is narrow */}
      {cells.length ? <div className={`grid gap-px [&>*]:bg-[var(--bg-panel)] ${cells.length >= 4 ? 'grid-cols-2 @[560px]:grid-cols-4' : cells.length === 3 ? 'grid-cols-3' : cells.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {cells}
      </div> : null}
      {audience ? (
        <div className={`${cells.length ? 'mt-px ' : ''}flex items-baseline gap-3 bg-[var(--bg-panel)] px-3.5 py-2.5`}>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-faint)]">{t('assetDrawer.metric_audience')}</span>
          <span className="min-w-0 text-[12.5px] leading-[18px] text-[var(--text)]">{audience}</span>
        </div>
      ) : null}
    </div>
  );
}
