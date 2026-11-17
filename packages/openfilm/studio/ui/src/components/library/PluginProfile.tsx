/**
 * A plugin's or a skill's profile as its page shows it at the top, the way a model's page sums a model up: a strip of
 * a few measures, each a mark to read at a glance and its word under it (what it is: an editor or a skill; how hard it
 * is to start with, as dots; how much the agent does, as bolts), and who it is for across the foot; a measure it has
 * nothing for is left out. Every plugin is free, so cost is not one of them.
 */
import React from 'react';
import {
  AppWindow, MessageSquare, Zap,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import type { Profile, Use } from '@/lib/plugin-profile';
import { inLanguage } from '../SkillPage';

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
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-faint)]">{name}</span>
      <span className="flex h-[18px] items-center">{children}</span>
      <span className="text-[13.5px] leading-[16px] text-[var(--text)]">{word}</span>
    </div>
  );
}

/**
 * The strip: the measures its profile has, and how it is used (`uses`); who it is for across its foot. A thing with
 * no profile shows how it is used only.
 */
export function ProfileStrip({ profile, uses: all }: { profile: Profile | undefined; uses: readonly Use[] }) {
  const t = useT();
  /* where a person meets it: its editor, the conversation (its commands are for code and agents, in its page's fold) */
  const uses = all.filter((u) => u !== 'commands');
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
  /* what it is: an editor (an interface of its own, picked at the top right) or a skill (the agent uses it in the chat) */
  const editor = uses.includes('surface');
  const TypeMark = editor ? AppWindow : MessageSquare;
  cells.unshift(
    <Cell key="type" name={t('assetDrawer.metric_type')} tip={t('assetDrawer.metricTip_type')} word={t(editor ? 'assetDrawer.typeNote_editor' : 'assetDrawer.typeNote_skill')}>
      <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-none text-[var(--text)]">
        <TypeMark size={15} strokeWidth={2} aria-hidden />{t(editor ? 'assetDrawer.kind_editor' : 'assetDrawer.kind_skill')}
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
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-faint)]">{t('assetDrawer.metric_audience')}</span>
          <span className="min-w-0 text-[14px] leading-[18px] text-[var(--text)]">{audience}</span>
        </div>
      ) : null}
    </div>
  );
}
