/**
 * Where an attached folder is, short enough for its card: the folder it sits in, the home folder written as "~", and
 * only the last two folders of a deep path ("…/Projects/2026"). Empty for a folder at the top of a disk.
 */
export function attachmentPlace(path: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\');
  const sep = windows ? '\\' : '/';
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (cut <= 0) return '';
  const parent = trimmed.slice(0, cut);
  const home = parent.match(/^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:[\\/]Users[\\/][^\\/]+)(?=$|[\\/])/);
  const rest = (home ? parent.slice(home[0].length) : parent).split(/[\\/]/).filter(Boolean);
  if (rest.length > 2) return ['…', ...rest.slice(-2)].join(sep);
  if (home) return ['~', ...rest].join(sep);
  return `${windows ? '' : '/'}${rest.join(sep)}`;
}
