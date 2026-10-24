/**
 * The file a step of the user's own agent names in its row (lib/local-agent-run localToolActivity): the base name of
 * its path, with either separator.
 *
 * The path is where ACP puts it, in the call's locations or its input (`file_path`, `path`, `filePath`), and else
 * in its title. A read's last update often carries only its title, or nothing but what was read, and each agent
 * titles a read its own way: Claude Code "Read .film\cache\look\0-5s.png (1 - 40)", OpenCode the path without its
 * drive ("Users\me\…\0-5s.png"), Copilot "Viewing …\look\0-5s.png", Cursor "Read C:\…\SKILL.md". A title that is
 * no path (Claude Code's "Read File" before it knows which, OpenCode's "read") names no file, so the row keeps the
 * one it has.
 *
 * Pure: no React, no bridge, so `node --test` runs it (src/step-file.test.mjs).
 */

export function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
}

/** The file a title names when it is a path, after its verb and line range; undefined when it is none. */
export function titleFile(title: string): string | undefined {
  const path = title.trim().replace(/^(?:Read|View Image|Viewing)\s+/i, '').replace(/\s+\((?:from line \d+|\d+ - \d+)\)$/, '');
  return /[\\/]|\.\w+$/.test(path) ? baseName(path) : undefined;
}
