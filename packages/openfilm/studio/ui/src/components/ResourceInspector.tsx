import React from 'react';
import { Download, File as FileIcon } from 'lucide-react';
import { cuePlain, readVtt } from '../../../../src/captions.mjs';
import { useT } from '@/i18n';
import { formatClipDuration, formatFileSize, proxyText, type WorkspaceResource, type WorkspaceResourceKind } from '@/lib/workspace-resources';
import { InspectorPanel } from './InspectorPanel';
import { KIND_ICON } from './MediaPreview';

/**
 * A media file's properties, in the inspector's place. `url` is the file itself on the film origin (Download);
 * `transcript`, its transcript's (lib/transcripts), whose lines are read here.
 */
export function ResourceInspector({ file, url, transcript, width, onClose }: {
  file: WorkspaceResource; url: string; transcript?: string; width: number; onClose: () => void;
}) {
  const t = useT();
  const Icon = KIND_ICON[file.kind] ?? FileIcon;
  return (
    <InspectorPanel title={t('assets.props')} width={width} onClose={onClose}>
      <div className="flex items-start gap-2.5 border-b border-[var(--border)] py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-field)] text-[var(--text-muted)]"><Icon size={18} /></span>
        <div className="min-w-0"><p className="whitespace-pre-wrap break-words text-[12px] font-medium">{file.name}</p><p className="mt-1 break-all text-[10px] leading-relaxed text-[var(--text-muted)]">{file.path}</p></div>
      </div>
      <AssetFields file={file} />
      {transcript ? (
        <div className="border-t border-[var(--border)] py-3">
          <p className="mb-2 text-[11px] font-medium text-[var(--text-muted)]">{t('media.transcriptTitle')}</p>
          <TranscriptLines url={transcript} />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4 text-[11px]">
        <a href={url} download={file.name} className="flex items-center gap-1.5 rounded-md bg-[var(--bg-field)] px-2.5 py-2 hover:bg-[var(--bg-hover)]"><Download size={13} />{t('assets.download')}</a>
      </div>
    </InspectorPanel>
  );
}

/** A WebVTT's lines as they read (a transcript, a subtitle file): each one's time, and what it says. */
export function TranscriptLines({ url }: { url: string }) {
  const t = useT();
  const [lines, setLines] = React.useState<{ start: number; text: string }[] | null>(null);
  React.useEffect(() => {
    let current = true;
    setLines(null);
    fetch(url).then((r) => (r.ok ? r.text() : '')).then(
      (text) => { if (current) setLines(readVtt(text).cues.map((c) => ({ start: c.start, text: cuePlain(c.text) }))); },
      () => { if (current) setLines([]); },
    );
    return () => { current = false; };
  }, [url]);
  if (!lines) return null;
  if (!lines.length) return <p className="text-[11.5px] text-[var(--text-faint)]">{t('media.transcriptEmpty')}</p>;
  return (
    <ol className="flex flex-col gap-1.5">
      {lines.map((line, i) => (
        <li key={i} className="flex gap-2 text-[12px] leading-[17px]">
          <span className="shrink-0 tabular-nums text-[var(--text-faint)]">{clockOf(line.start)}</span>
          <span className="min-w-0 break-words text-[var(--text)]">{line.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Seconds as a line's time: 0:04, 1:12. */
const clockOf = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

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
function AssetFields({ file }: { file: WorkspaceResource }) {
  const t = useT();
  const rows: { label: string; value: string }[] = [
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
