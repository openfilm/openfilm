/**
 * The key combination shown in a shortcut hint.
 *
 * The modifier follows the platform: `⌘` on Mac, `Ctrl` elsewhere. Hard-coding one would leave
 * people on the other platform pressing keys that do nothing, and the whole point of a hint is
 * to be pressed as shown.
 *
 * Detection uses `navigator.platform` (rather than looking for "Mac" in the userAgent): it is
 * marked deprecated but is still the most accurate here, and its replacement
 * (`navigator.userAgentData`) is missing in Safari and Firefox. When it is unavailable we
 * assume non-Mac, the more common case.
 */
export function shortcutHint(key: string, opts?: { mod?: boolean; shift?: boolean; alt?: boolean }): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const parts: string[] = [];
  if (opts?.mod) parts.push(mac ? '⌘' : 'Ctrl');
  if (opts?.alt) parts.push(mac ? '⌥' : 'Alt');
  if (opts?.shift) parts.push(mac ? '⇧' : 'Shift');
  parts.push(key);
  return mac ? parts.join('') : parts.join('+');
}
