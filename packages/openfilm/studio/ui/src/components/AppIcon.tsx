/**
 * An app icon, as every plugin and skill has one, drawn as iOS draws an app's: the square picture its folder brings
 * (icon.svg, icon.png or icon.webp at its root, full bleed, as an app icon is made: openfilm/src/skills.mjs appIconIn)
 * in the continuous rounded square every icon shares, with a hairline round it. One that brings none, or whose
 * picture does not load, has its kind's default (assets/app-icons); one still to come may show its own mark on that
 * default's grey.
 */
import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import pluginIcon from '@/assets/app-icons/plugin.svg';
import skillIcon from '@/assets/app-icons/skill.svg';

export type AppKind = 'plugin' | 'skill';

const DEFAULTS: Record<AppKind, string> = { plugin: pluginIcon, skill: skillIcon };

/** The rounded square every icon is drawn in: a continuous (squircle) corner, as iOS's, where the browser draws one. */
const shape = (size: number): React.CSSProperties => ({ borderRadius: Math.round(size * 0.3), cornerShape: 'squircle' } as React.CSSProperties);

export function AppIcon({ src, kind, size = 40, mark: Mark, className = '' }: {
  /** its picture (none: the default for its kind) */
  src?: string | undefined;
  kind: AppKind;
  size?: number;
  /** a mark of its own on the default's grey, for one that has no picture yet */
  mark?: LucideIcon | undefined;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);
  const own = src && !failed;
  return (
    <span aria-hidden data-app-icon={own ? 'own' : kind}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{ width: size, height: size, ...shape(size), ...(own || !Mark ? {} : { background: 'linear-gradient(180deg, #b4b4bb 0%, #6e6e75 100%)' }) }}>
      {own || !Mark
        ? <img src={own ? src : DEFAULTS[kind]} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        : <Mark size={Math.round(size * 0.5)} strokeWidth={2} color="#fff" />}
      {/* a hairline round it, so a white icon keeps its edge on a white page */}
      <span className="pointer-events-none absolute inset-0" style={{ ...shape(size), boxShadow: 'inset 0 0 0 0.5px rgb(0 0 0 / 0.14)' }} />
    </span>
  );
}
