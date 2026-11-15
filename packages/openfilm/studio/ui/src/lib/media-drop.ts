/** Capture File objects during the drop event; Chromium protects the drag store afterwards. */
export function mediaDropFiles(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  return Array.from(data.items ?? []).flatMap((item) => {
    if (item.kind !== 'file') return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}

/** Internal tiles sometimes carry image files too; they must keep their move/insert behavior. */
export function isMediaFileDrop(data: Pick<DataTransfer, 'types' | 'items'>): boolean {
  if (data.types.includes('application/x-openfilm-media') || data.types.includes('application/x-openfilm-resource'))
    return false;
  return data.types.includes('Files') || Array.from(data.items ?? []).some((item) => item.kind === 'file');
}
