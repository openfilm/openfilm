/**
 * The ways to start a film, at the top of the projects' page (the desktop sidebar's, components/SidePage): a row of
 * coloured tiles, each a way in: a blank film, one begun on the canvas, a folder of this computer, a repository, an
 * example. A tile is its colour and its mark; its name under it.
 */
import * as React from 'react';
import { Clapperboard, FolderOpen, Github, Shapes, Sparkles } from 'lucide-react';
import { useT } from '@/i18n';
import styles from './ProjectStarts.module.css';

export function ProjectStarts({ busy, onNew, onCanvas, onFolder, onGitHub, onExamples }: {
  busy: boolean;
  onNew: () => void; onCanvas: () => void; onFolder: () => void; onGitHub: () => void; onExamples: () => void;
}) {
  const t = useT();
  const tile = (id: string, tone: string, icon: React.ReactNode, label: string, run: () => void, making = false) => (
    <button key={id} type="button" className={styles.tile} data-start={id} disabled={making && busy} onClick={run}>
      <span className={styles.face} data-tone={tone}>{icon}</span>
      <span className={styles.label}>{label}</span>
    </button>
  );
  const mark = { size: 34, strokeWidth: 1.5, 'aria-hidden': true } as const;
  return (
    <section className={styles.starts} aria-label={t('desktopNavigation.startTitle')}>
      <h3>{t('desktopNavigation.startTitle')}</h3>
      <div className={styles.row}>
        {tile('new', 'blue', <Clapperboard {...mark} />, t('desktopNavigation.startBlank'), onNew, true)}
        {tile('canvas', 'violet', <Shapes {...mark} />, t('desktopNavigation.startCanvas'), onCanvas, true)}
        {tile('example', 'teal', <Sparkles {...mark} />, t('desktopNavigation.startExample'), onExamples)}
        {tile('folder', 'amber', <FolderOpen {...mark} />, t('projects.openFolderShort'), onFolder)}
        {tile('github', 'slate', <Github {...mark} />, t('projects.githubShort'), onGitHub)}
      </div>
    </section>
  );
}
