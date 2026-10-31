/**
 * A thing of the library tried in the viewer (a click in the assets drawer, LibraryDrawer), over the picture there and
 * nothing written: a page laid over it (a sticker in its middle, at a size it can be seen), the preview of a transition
 * or of a text look or motion, and
 * for a look only the word that it is tried (the look itself is on the clip, through the stage's look preview).
 */
import { useLanguage, useT } from '@/i18n';
import { nameOf, pageUrl, previewUrl, type LibraryItem } from '@/lib/library';

export function LibraryTrial({ item }: { item: LibraryItem }) {
  const t = useT();
  const lang = useLanguage();
  const page = item.kind === 'page' && item.cat !== 'transition';
  /* a sticker has a size of its own: shown as a third of the picture's height, in its middle */
  const sticker = page && item.w && item.h;
  return (
    <div data-library-trial="" className="pointer-events-none absolute inset-0 z-[6] overflow-hidden">
      {page ? (
        <iframe
          title={nameOf(item.name, lang)}
          src={pageUrl(item)}
          className={sticker ? 'absolute left-1/2 top-1/2 h-[36%] -translate-x-1/2 -translate-y-1/2 border-0' : 'absolute inset-0 h-full w-full border-0'}
          style={sticker ? { aspectRatio: `${item.w} / ${item.h}`, colorScheme: 'normal' } : { colorScheme: 'normal' }}
        />
      ) : null}
      {item.cat === 'transition' || item.kind === 'textstyle' || item.kind === 'textmotion' ? <video src={previewUrl(item)} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
      <div className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] text-white">{t('assetDrawer.trying').replace('{name}', nameOf(item.name, lang))}</div>
    </div>
  );
}
