/**
 * Full-screen loading: the logo and a moving bar, while a project opens.
 *
 * Opening a project means finding (or making) it and then reading its film. Both involve a
 * noticeable wait, and during that wait **the screen must change**: when the UI sits still,
 * people do not think "it is loading", they think "did I miss the click?" and click again.
 *
 * So no skeleton is drawn here. A skeleton guesses what will appear, and a wrong guess is
 * costly: a new project lands on an empty picture, while a skeleton would first show blocks
 * that are not there, making the page flash when loading ends. A full-screen background with
 * the logo guesses nothing; what lands is covered up, not corrected.
 *
 * Two places show it in turn: App while it finds the project to open, then ProjectView while
 * that project loads. Both look identical, so the handoff has no visible seam; the user sees
 * one loading screen that stays lit throughout, not two that flash in turn.
 */
import { useT } from '@/i18n';
import { BrandLogo } from './BrandLogo';

export function BrandLoadingScreen({
  labelKey,
}: {
  /** What is being done (an i18n key): both callers pass the same one and get the same sentence. */
  labelKey?: string;
}) {
  const t = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy
      /* No entrance animation. This screen is mounted twice (App first, then ProjectView), and
         the second mount would replay the entrance, flashing the whole screen at the handoff,
         which is worse than having no loading screen. */
      /* The background is --panel, the same as the workspace's when it lands, so when the loading
         screen gives way the content just grows in and the base color never moves. */
      className="workspace-shell z-[9000] flex flex-col items-center justify-center bg-[var(--panel)]"
    >
      {/* Kept small: an enlarged logo in the middle of the screen looks like a splash ad, while
          this screen only means "one moment". The bar below is what moves. */}
      <span className="text-[var(--text)]"><BrandLogo size={34} /></span>

      {labelKey ? (
        <p className="mt-6 text-[14px] font-medium tracking-[-0.01em] text-[var(--text)]">
          {t(labelKey)}
        </p>
      ) : null}

      {/* The bar is fake: opening a project cannot report a percentage. It only says one thing
          here: something is still moving. A line frozen in one place would look stuck. */}
      <div className="mt-5 h-[3px] w-[180px] overflow-hidden rounded-full bg-[var(--border)]">
        <div className="openfilm-loading-bar h-full w-1/3 rounded-full bg-[var(--text)]/60" />
      </div>
    </div>
  );
}
