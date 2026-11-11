import React from 'react';
import { Check, Copy, Download, File as FileIcon, RefreshCw, Unlink } from 'lucide-react';
import type { MediaMade } from '@/api';
import { useT } from '@/i18n';
import { formatClipDuration, formatFileSize, proxyText, type MediaSources, type WorkspaceResource, type WorkspaceResourceKind } from '@/lib/workspace-resources';
import { InspectorPanel } from './InspectorPanel';
import { KIND_ICON, MediaPreview } from './MediaPreview';

/**
 * How a file was made, for the inspector to say (MadeSection): what is on record of it, the project's files by path
 * and where their pictures come from (what it was made from, its other versions), a file shown in its place, and the
 * same thing asked for once more (resolves when it is made, or says why not).
 */
export interface MadeProps {
  made: MediaMade;
  fileAt?: (path: string) => WorkspaceResource | undefined;
  sources?: MediaSources;
  onShow?: (path: string) => void;
  onAgain?: () => Promise<void>;
}

/**
 * A media file's properties, in the inspector's place. `url` is the file itself on the film origin (Download). A file
 * of the media library (lib/media-library) says where it is and how many projects use it (`from`), in place of its path.
 */
export function ResourceInspector({ file, url, width, onClose, from, made }: {
  file: WorkspaceResource; url: string; width: number; onClose: () => void; from?: { name: string; uses: number } | undefined;
  /** How it was made, when a service made or found it (studio/server/media-made.mjs). */
  made?: MadeProps | undefined;
}) {
  const t = useT();
  const Icon = KIND_ICON[file.kind] ?? FileIcon;
  return (
    <InspectorPanel title={t('assets.props')} width={width} onClose={onClose}>
      <div className="flex items-start gap-2.5 border-b border-[var(--border)] py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-field)] text-[var(--text-muted)]"><Icon size={18} /></span>
        <div className="min-w-0"><p className="whitespace-pre-wrap break-words text-[12px] font-medium">{file.name}</p><p className="mt-1 break-all text-[10px] leading-relaxed text-[var(--text-muted)]">{from ? from.name : file.path}</p></div>
      </div>
      {made ? <MadeSection key={file.path} file={file} {...made} /> : null}
      <AssetFields file={file} from={from} />
      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4 text-[11px]">
        <a href={url} download={file.name} className="flex items-center gap-1.5 rounded-md bg-[var(--bg-field)] px-2.5 py-2 hover:bg-[var(--bg-hover)]"><Download size={13} />{t('assets.download')}</a>
      </div>
    </InspectorPanel>
  );
}

function fileExtension(name: string): string {
  const cut = name.lastIndexOf('.');
  return cut <= 0 ? '' : name.slice(cut + 1).toLowerCase();
}

function assetTypeText(file: WorkspaceResource, t: (path: string) => string): string {
  const label = assetKindLabel(file.kind, t);
  if (file.kind === 'mg') return label;
  const ext = fileExtension(file.name);
  return ext ? `${label} · ${ext.toUpperCase()}` : label;
}

function assetKindLabel(kind: WorkspaceResourceKind, t: (path: string) => string): string {
  if (kind === 'mg') return t('assets.kindPage');
  if (kind === 'video') return t('assets.catVideo');
  if (kind === 'image') return t('assets.catImage');
  if (kind === 'audio') return t('assets.kindAudio');
  return t('assets.catOther');
}

/** Frame rate as people say it: 29.97 keeps two decimals, 30 is 30. */
function formatFps(fps: number): string {
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * A file's facts, read-only: one per row and not drawn as inputs — anything that looks like an input gets clicked,
 * and none of these can be changed. Everything comes from props, so the panel opens without a request.
 */
function AssetFields({ file, from }: { file: WorkspaceResource; from?: { name: string; uses: number } | undefined }) {
  const t = useT();
  const rows: { label: string; value: string }[] = [
    ...(from ? [
      { label: t('assets.propFrom'), value: from.name },
      /* one project: the one it is from */
      ...(from.uses > 1 ? [{ label: t('assets.propUses'), value: t('assets.propUsesValue').replace('{n}', String(from.uses)) }] : []),
    ] : []),
    { label: t('assets.propType'), value: assetTypeText(file, t) },
    { label: t('assets.propSize'), value: formatFileSize(file.size) },
  ];
  if (file.durationMs) {
    rows.push({ label: t('assets.propDuration'), value: formatClipDuration(file.durationMs) });
  }
  if (file.w && file.h) {
    rows.push({ label: t('assets.propDimensions'), value: `${file.w} × ${file.h}` });
  }
  /* only footage has a frame rate; 25 and 30 mixed in one film repeat a frame every few on export, and this is
     where it shows before then */
  if (file.kind === 'video' && file.fps) {
    rows.push({ label: t('assets.propFps'), value: `${formatFps(file.fps)} fps` });
  }
  if (file.mtimeMs) {
    rows.push({ label: t('assets.propModified'), value: new Date(file.mtimeMs).toLocaleString() });
  }
  /* heavy footage's proxy for the preview, or the copy this browser plays it from: being made, ready, or not to be */
  if (file.proxy) rows.push({ label: t('assets.propProxy'), value: proxyText(file.proxy, t) });
  /* a link to media kept elsewhere (a NAS): where it is, or that it cannot be reached now */
  if (file.link) {
    rows.push({ label: t('assets.propLinked'), value: file.link.missing ? `${file.link.to} (${t('media.linkMissing')})` : file.link.to });
  }

  return (
    <dl className="py-2">
      {rows.map((row) => (
        <div key={row.label} className="border-t border-[var(--border)] py-2 first:border-t-0 first:pt-1">
          <dt className="text-[11px] leading-none text-[var(--text-muted)]">{row.label}</dt>
          <dd className="mt-1 break-all text-[12px] leading-[1.45] text-[var(--text)]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What was asked beside the words, by the option's name: the ones with a word of their own here. */
const ARG_WORDS = ['ratio', 'duration', 'sec', 'resolution', 'quality', 'size', 'voice', 'format', 'orientation', 'n'];
/** Seconds are said with their unit. */
const ARG_SECONDS = ['duration', 'sec'];

/**
 * How the file was made: the words it was asked with (copied with a click), who made it with which model and the
 * rest of what was asked, the files it was made from and its other versions (each shown with a click), and the same
 * thing asked for once more. Something found on the web says whose it is and where it was found.
 */
function MadeSection({ file, made, fileAt, sources, onShow, onAgain }: { file: WorkspaceResource } & MadeProps) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const [making, setMaking] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const asked = Object.entries(made.args).filter(([name]) => name !== 'n' || made.found)
    .map(([name, value]) => `${ARG_WORDS.includes(name) ? t(`made.arg_${name}`) : name} ${value === 'true' ? '' : ARG_SECONDS.includes(name) ? `${value} s` : value}`.trim());
  const thumbs = (paths: readonly { path: string | null; name: string }[], current?: string) => (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {paths.map((p, i) => {
        const at = p.path ? fileAt?.(p.path) : undefined;
        return at && sources ? (
          <button key={`${p.path}:${i}`} type="button" title={at.name} onClick={() => onShow?.(at.path)}
            className={`relative aspect-video w-16 overflow-hidden rounded-[5px] bg-[var(--bg-hover)] ring-2 transition ${at.path === current ? 'ring-[var(--accent)]' : 'ring-transparent hover:ring-[var(--border-strong)]'}`}>
            <MediaPreview file={at} sources={sources} />
          </button>
        ) : (
          <span key={`${p.name}:${i}`} title={`${p.name} · ${t('made.refGone')}`}
            className="flex aspect-video w-16 items-center justify-center rounded-[5px] bg-[var(--bg-hover)] text-[var(--text-faint)]"><Unlink size={13} /></span>
        );
      })}
    </div>
  );
  const label = 'text-[11px] leading-none text-[var(--text-muted)]';
  return (
    <section data-media-made="" className="border-b border-[var(--border)] py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium text-[var(--text-muted)]">{t(made.found ? 'made.titleFound' : 'made.title')}</h3>
        {made.words ? (
          <button type="button" title={t('made.copy')} aria-label={t('made.copy')}
            onClick={() => { void navigator.clipboard?.writeText(made.words).then(() => setCopied(true), () => {}); }}
            className="flex size-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        ) : null}
      </div>
      {made.words ? (
        <p className="mt-1.5 max-h-40 select-text overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg-field)] px-2 py-1.5 text-[12px] leading-[1.5] text-[var(--text)]">{made.words}</p>
      ) : null}
      <p className="mt-2 break-words text-[11.5px] leading-[1.5] text-[var(--text-muted)]">
        {[made.by, made.model, ...asked, new Date(made.at).toLocaleDateString()].filter(Boolean).join(' · ')}
      </p>
      {made.credit || made.page ? (
        <p className="mt-1 break-all text-[11.5px] leading-[1.5] text-[var(--text-muted)]">
          {made.credit ? t('made.credit').replace('{who}', made.credit) : null}{made.credit && made.page ? ' · ' : null}
          {made.page ? <a href={made.page} target="_blank" rel="noreferrer" className="underline decoration-[var(--border-strong)] hover:text-[var(--text)]">{t('made.page')}</a> : null}
        </p>
      ) : null}
      {made.refs?.length ? (<div className="mt-2.5"><p className={label}>{t('made.refs')}</p>{thumbs(made.refs)}</div>) : null}
      {made.versions && made.versions.length > 1 ? (
        <div className="mt-2.5"><p className={label}>{t('made.versions').replace('{n}', String(made.versions.length))}</p>
          {thumbs(made.versions.map((path) => ({ path, name: path.slice(path.lastIndexOf('/') + 1) })), file.path)}</div>
      ) : null}
      {made.again && onAgain ? (
        <button type="button" disabled={making}
          onClick={() => { setMaking(true); void onAgain().finally(() => setMaking(false)); }}
          className="mt-3 flex items-center gap-1.5 rounded-md bg-[var(--bg-field)] px-2.5 py-2 text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-60">
          <RefreshCw size={13} className={making ? 'animate-spin' : ''} />{t(making ? 'made.making' : 'made.again')}
        </button>
      ) : null}
    </section>
  );
}
