/**
 * The storyboard (`.film/pipeline/storyboard.md`): the film's shots in order, each a `## Shot n — seconds` heading
 * with fields under it — its page, its voice, its words on screen, the media it needs. The agent writes it as the
 * storyboard stage's guide shows; this reads it, and `checkStoryboard` holds it against the project for
 * `openfilm pipeline check`: every page written, every media file present, every voice recorded, the seconds adding
 * up to the film's. It is the plan, not the film: nothing else in the tools reads it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clipKind, readFilmFile } from './film-doc.mjs';

/** The storyboard file of the project `project` (the folder with film.html). */
export const storyboardFile = (project) => join(project, '.film', 'pipeline', 'storyboard.md');

/** A shot's voice is recorded by its number, in the first of these forms that is in the project. */
const VOICE_EXTS = ['wav', 'mp3', 'm4a', 'flac', 'ogg'];

/** The fields a shot has; a shot with another field is said so, rather than read past it. */
const FIELDS = ['page', 'vo', 'text', 'media', 'notes'];

/** The storyboard read whole, or null when there is none. */
export function readStoryboard(project) {
  const file = storyboardFile(project);
  if (!existsSync(file)) return null;
  return parseStoryboard(readFileSync(file, 'utf8'), '.film/pipeline/storyboard.md');
}

/** The file a field names, as the project has it: the part-of-the-file (`#t=…`, film.html's business) off, its escapes read, its backslashes forward. */
const filePath = (value) => {
  const [path] = value.split('#');
  try { return decodeURIComponent(path).replaceAll('\\', '/'); } catch { return path.replaceAll('\\', '/'); }
};

/** The shots' seconds, added up. */
export const storyboardSeconds = (shots) =>
  shots.reduce((all, { seconds }) => all + (Number.isFinite(seconds) ? seconds : 0), 0);

/**
 * A storyboard parsed: `shots` in order — each its number, seconds, name, fields, and the heading it was read from —
 * and `problems`, each saying where in the text it is. Problems are the text's alone: what the project lacks is
 * `checkStoryboard`'s to say. Prose between shots is read past.
 */
export function parseStoryboard(text, file = 'storyboard.md') {
  const shots = [];
  const problems = [];
  let shot = null;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const at = `${file}:${i + 1}`;
    const heading = line.match(/^#{1,3}\s+shot\b\s*(.*)$/i);
    if (heading) {
      const form = 'a shot heading says `## Shot 1 — 4s`, with an optional name after another dash';
      const m = heading[1].trim().match(/^(?<n>\d+)\s*(?:[-–—:]?\s*(?<seconds>[\d.]+)\s*(?:s|sec|seconds)\b)?\s*(?:[-–—:]\s*(?<name>.*))?$/i);
      if (!m) {
        problems.push(`${at}: ${form}, not "${line.trim()}"`);
        shot = null;
        continue;
      }
      if (m.groups.seconds == null) problems.push(`${at}: ${form}, not "${line.trim()}"`);
      const n = Number(m.groups.n);
      if (shots.some((s) => s.n === n)) problems.push(`${at}: shot ${n} twice; each number names one shot`);
      shot = {
        n,
        ...(m.groups.seconds != null ? { seconds: Number(m.groups.seconds) } : {}),
        name: (m.groups.name ?? '').trim(),
        page: null, vo: null, text: null, notes: null,
        media: [], unknown: [], heading: line.trim(),
      };
      shots.push(shot);
      continue;
    }
    const field = shot && line.match(/^\s*([a-z][a-z-]*)\s*:\s*(.*)$/i);
    if (!field) continue;
    const key = field[1].toLowerCase();
    const value = field[2].trim();
    if (!FIELDS.includes(key)) {
      shot.unknown.push(key);
      problems.push(`${at}: a shot has no ${key}; these are a shot's fields: ${FIELDS.join(', ')}`);
      continue;
    }
    if (key === 'media') { if (value) shot.media.push(filePath(value)); }
    else if (key === 'page') shot.page = value ? filePath(value) : null;
    else shot[key] = value || null;
  }
  return { shots, problems, file };
}

/** The `get` verb that makes what a media path names, by where it lives; null when it is not one get makes. */
export const getVerbFor = (media) => {
  const p = media.replaceAll('\\', '/');
  if (p.startsWith('assets/image/')) return 'image';
  if (p.startsWith('assets/video/')) return 'video';
  if (p.startsWith('assets/audio/music/')) return 'music';
  if (p.startsWith('assets/audio/sfx/')) return 'sfx';
  return null;
};

/** The voice recorded for shot `n`, by its number: the first form in the project, else null. */
const voiceOf = (project, n) => {
  for (const ext of VOICE_EXTS) {
    const path = `assets/audio/vo/shot-${n}.${ext}`;
    if (existsSync(join(project, path))) return path;
  }
  return null;
};

/** Seconds as they are said: 20, not 20.00. */
const said = (s) => `${+s.toFixed(2)}`;

/** How long a clip of film.html lasts on the film, from its part of the file and its speed; null when it is its own. */
const cutLength = (clip) => {
  const time = Array.isArray(clip.time) ? clip.time : [];
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  return time.length === 2 ? (time[1] - time[0]) / speed : null;
};

/**
 * The storyboard held against the project: a line per thing it calls for that is not there, each under the stage
 * that fills it — assets for media and voices, assembly for pages and the cut — so the check is the work list of
 * the stage the film is at. A page the project has is held to film.html as well: cut in, in the storyboard's order,
 * for its seconds. A film.html that does not read is said once, not per shot. `ok` when nothing is missing.
 */
export function checkStoryboard(project, { shots, problems, file }, { seconds, run = 'openfilm' } = {}) {
  const rows = problems.map((problem) => ['', problem]);
  const total = storyboardSeconds(shots);
  const filmFile = join(project, 'film.html');
  const filmRead = existsSync(filmFile) ? readFilmFile(readFileSync(filmFile, 'utf8')) : null;
  const cut = filmRead?.doc
    ? (filmRead.doc.tracks ?? []).flatMap(({ clips }) => clips).filter((clip) => clipKind(clip.src) === 'page')
    : [];
  if (filmRead && !filmRead.doc && shots.some((shot) => shot.page)) {
    rows.push(['', 'film.html does not read as a film; `openfilm look` says where']);
  }
  const firsts = [];
  const readable = filmRead?.doc != null;
  for (const shot of shots) {
    if (!shot.page) rows.push([`shot ${shot.n}`, `no page: every shot is made as a page (\`${run} pipeline storyboard\` shows the form)`]);
    else if (!existsSync(join(project, shot.page))) rows.push([`shot ${shot.n}`, `page ${shot.page} is not written yet (assembly)`]);
    else if (readable) {
      const found = cut.filter((clip) => filePath(clip.src) === shot.page);
      if (!found.length) rows.push([`shot ${shot.n}`, `page ${shot.page} is not cut into film.html (assembly)`]);
      else {
        firsts.push(cut.indexOf(found[0]));
        const length = cutLength(found[0]);
        if (length != null && Number.isFinite(shot.seconds) && Math.abs(length - shot.seconds) > 0.05) {
          rows.push([`shot ${shot.n}`, `film.html gives it ${said(length)} s; the storyboard says ${said(shot.seconds)} s (assembly)`]);
        }
      }
    }
    for (const media of shot.media) {
      if (existsSync(join(project, media))) continue;
      const verb = getVerbFor(media);
      const hint = verb ? `assets: \`${run} get ${verb} --out ${media} --prompt "…"\`` : 'assets: your service, or media the person has';
      const under = /^assets\//.test(media) ? '' : ' (the manual keeps media under assets/)';
      rows.push([`shot ${shot.n}`, `media ${media} is missing${under} (${hint})`]);
    }
    if (shot.vo && !voiceOf(project, shot.n)) {
      const path = `assets/audio/vo/shot-${shot.n}.wav`;
      rows.push([`shot ${shot.n}`, `voice not recorded: ${path} (assets: \`${run} get tts --out shot-${shot.n} --voice <voiceId> --text "${shot.vo}"\`)`]);
    }
  }
  let ordered = true;
  for (let i = 1; i < firsts.length; i++) if (firsts[i] < firsts[i - 1]) ordered = false;
  if (firsts.length && !ordered) rows.push(['order', `film.html cuts the shots out of the storyboard's order (assembly)`]);
  if (Number.isFinite(seconds) && shots.length && Math.abs(total - seconds) > 0.001) {
    rows.push(['seconds', `the shots add up to ${said(total)} s; the film is ${said(seconds)} s (storyboard)`]);
  }
  if (!shots.length && !problems.length) rows.push(['', `no shots in it: \`${run} pipeline storyboard\` shows the form`]);
  const width = Math.max(...rows.map(([label]) => label.length), 'storyboard'.length);
  const lines = [`storyboard  ${file} — ${shots.length} shot${shots.length === 1 ? '' : 's'}, ${said(total)} s`];
  for (const [label, text] of rows) lines.push(`${label.padEnd(width + 2)}${text}`);
  lines.push('', rows.length
    ? `check  ${rows.length} thing${rows.length === 1 ? '' : 's'} the film still needs; check again as the stages land their work`
    : 'check  the storyboard holds: every page written and cut in, every media file present, every voice recorded, the seconds adding up');
  return { ok: !rows.length, lines };
}
