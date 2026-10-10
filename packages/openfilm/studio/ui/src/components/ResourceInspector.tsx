import { Download, File as FileIcon } from 'lucide-react';
import { useT } from '@/i18n';
import { formatClipDuration, type WorkspaceResource, type WorkspaceResourceKind } from '@/lib/workspace-resources';
import { InspectorPanel } from './InspectorPanel';
import { KIND_ICON } from './MediaPreview';

/** A media file's properties, in the inspector's place. `url` is the file itself on the film origin (Download). */
export function ResourceInspector({ file, url, width, onClose }: {
  file: WorkspaceResource; url: string; width: number; onClose: () => void;
}) {
  const t = useT();
  const Icon = KIND_ICON[file.kind] ?? FileIcon;
  return (
    <InspectorPanel title={t('assets.props')} width={width} onClose={onClose}>
      <div className="flex items-start gap-2.5 border-b border-[var(--border)] py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--fill-tsp)] text-[var(--text-muted)]"><Icon size={18} /></span>
        <div className="min-w-0"><p className="whitespace-pre-wrap break-words text-[12px] font-medium">{file.name}</p><p className="mt-1 break-all text-[10px] leading-relaxed text-[var(--text-muted)]">{file.path}</p></div>
      </div>
      <AssetFields file={file} />
      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4 text-[11px]">
        <a href={url} download={file.name} className="flex items-center gap-1.5 rounded-md bg-[var(--fill-tsp)] px-2.5 py-2 hover:bg-[var(--bg-hover)]"><Download size={13} />{t('assets.download')}</a>
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

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** "12.3 MB": the order of magnitude is what a person reads, not the exact byte count. */
function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  /* no decimals for bytes or past three digits ("248 MB" reads better than "248.3 MB") */
  const text = value.toFixed(unit === 0 || value >= 100 ? 0 : 1);
  /* 1023.97 KB rounds to 1024.0, which is 1 MB */
  return Number(text) >= 1024 && unit < SIZE_UNITS.length - 1
    ? `1.0 ${SIZE_UNITS[unit + 1]}`
    : `${text} ${SIZE_UNITS[unit]}`;
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
