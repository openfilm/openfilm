/**
 * A text style of the library drawn the way the text component draws it (its CSS variables on a few words), as large
 * as its card lets them be, in the app's language: what picking it gives, not a small picture of English words.
 */
import type { Language } from '@/i18n';
import * as React from 'react';
import { BUILT_IN, TEXT_COMPONENT, builtInItem, libraryUrl, pageUrl } from '@/lib/library';
import { TEXT_DEFAULTS } from '@/lib/text-look';

/* the display fonts the text component comes with (library/text/text/files/fonts), on Studio's page under names of
   their own, so that no font menu here takes them for fonts this computer has */
const FONTS = [['Smiley Sans', 'SmileySans.woff2', 'woff2'], ['ZCOOL KuaiLe', 'ZCOOLKuaiLe.ttf', 'truetype']] as const;
const OWN = 'OpenFilm Text ';
let fontsIn = false;
function putFontsIn(): void {
  if (fontsIn || typeof document === 'undefined') return;
  fontsIn = true;
  const style = document.createElement('style');
  style.textContent = FONTS.map(([family, file, format]) =>
    `@font-face { font-family: '${OWN}${family}'; src: url('${libraryUrl(`${TEXT_COMPONENT}/files/fonts/${file}`)}') format('${format}'); font-display: swap; }`).join('\n');
  document.head.append(style);
}
const fontOf = (font: string) => FONTS.reduce((f, [family]) => f.replaceAll(`'${family}'`, `'${OWN}${family}'`), font);

/** The words a style is shown with, in the app's language. */
export const sampleWords = (lang: Language): string => (lang === 'zh-CN' ? '花字' : lang === 'ja' ? '文字' : lang === 'ko' ? '글자' : 'Aa');

const CARD = 'radial-gradient(120% 95% at 50% 30%, #3b3c40 0%, #222326 75%)';

/* how many em a length of the box's padding is (a share of the words' size; anything else counts as none) */
const em = (v: string | undefined) => (v?.trim().endsWith('em') ? Number.parseFloat(v) || 0 : 0);
/** The box's padding at its sides and at its top and bottom, in em (`0.22em 0.6em`: 0.6 a side, 0.22 above and below). */
function padOf(pad: string): { x: number; y: number } {
  const [top, right = top, bottom = top, left = right] = pad.trim().split(/\s+/);
  return { x: em(right) + em(left), y: em(top) + em(bottom) };
}
/* how wide the words are, in em: a CJK character a whole one, a Latin letter about 0.62 */
const wordsEm = (words: string, spacing: number) => [...words].reduce((n, c) => n + (c.codePointAt(0)! >= 0x2e80 ? 1 : 0.62) + spacing, 0);

/* a motion played under the pointer again and again: in, a while shown, out */
const ROUND = 2.2;

/**
 * A text style (`vars`: its variables, none for the page's own) on a dark card, the words filling it; a motion
 * (`moving`: its variables) played on them by the text component itself while `playing`. Fills its parent.
 */
export function TextStyleSample({ vars, lang, moving, playing, words = sampleWords(lang) }: {
  vars?: Record<string, string> | undefined; lang: Language; moving?: Record<string, string> | undefined; playing?: boolean;
  /** what it says (the style's sample words by default) */
  words?: string;
}) {
  putFontsIn();
  const v = { ...TEXT_DEFAULTS, ...vars };
  const pad = padOf(v['--box-pad']!);
  /* the words as large as the card's height and width let them be, with their box and a little room for an edge, a
     shadow or a glow */
  const wide = wordsEm(words, em(v['--spacing'])) + pad.x + 0.3;
  const tall = 1.15 + pad.y + 0.25;
  const fill = v['--fill'] && v['--fill'] !== 'none' ? v['--fill'] : undefined;
  const component = moving && playing ? builtInItem(`${BUILT_IN}/${TEXT_COMPONENT}`) : null;
  /* the motion's page shown once its font is in and its motion started again (the drawn words stay under it till
     then, so nothing goes blank), and played from its start again each round in the same page */
  const page = React.useRef<HTMLIFrameElement>(null);
  const [shown, setShown] = React.useState(false);
  const replay = React.useCallback(() => {
    try { for (const a of page.current?.contentDocument?.getAnimations() ?? []) a.currentTime = 0; } catch { /* not ours to reach */ }
  }, []);
  React.useEffect(() => {
    setShown(false);
    if (!component) return undefined;
    const timer = window.setInterval(replay, (ROUND + 0.5) * 1000);
    return () => window.clearInterval(timer);
  }, [component, replay]);
  const ready = () => {
    const doc = page.current?.contentDocument;
    void (doc?.fonts?.ready ?? Promise.resolve()).then(() => { replay(); setShown(true); });
  };
  const src = component
    ? `${pageUrl(component)}?vars=${encodeURIComponent(JSON.stringify({ ...vars, ...moving, '--clip-length': `${ROUND}s` }))}&words=${encodeURIComponent(words)}`
    : null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden [container-type:size]"
      style={{ background: CARD }}>
      {src ? <iframe ref={page} title="" src={src} tabIndex={-1} onLoad={ready} className="absolute inset-0 z-[1] h-full w-full border-0"
        style={{ colorScheme: 'normal', background: CARD, opacity: shown ? 1 : 0 }} /> : null}
      <span style={{
        fontSize: `min(${(78 / tall).toFixed(2)}cqh, ${(88 / wide).toFixed(2)}cqw)`, lineHeight: 1,
        background: v['--box'], padding: v['--box-pad'], borderRadius: v['--box-radius'],
      }}>
        <span style={{
          display: 'inline-block', whiteSpace: 'pre', lineHeight: 1.15,
          fontFamily: fontOf(v['--font']!), fontWeight: v['--weight'], fontStyle: v['--italic'], letterSpacing: v['--spacing'],
          color: v['--color'],
          ...(fill ? { background: fill, WebkitBackgroundClip: 'text', backgroundClip: 'text' } : {}),
          WebkitTextStroke: `${v['--stroke']} ${v['--stroke-color']}`, paintOrder: 'stroke fill',
          textShadow: v['--shadow'], filter: v['--glow'],
        }}>{words}</span>
      </span>
    </span>
  );
}
