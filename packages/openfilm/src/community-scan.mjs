// @ts-nocheck
// The community's scan, as its repository runs it on every pull request (openfilm/community scripts/scan.mjs, the part that
// reads a folder; copied as it is, so `openfilm publish` finds what the review will): keep the two the same.
// Reads an item's folder for what the developer policy bans, and says where. It only reads: nothing in the folder is
// run, imported or installed.
//
//   node scripts/scan.mjs <folder>                   one folder; its openfilm.json says what it declares
//   node scripts/scan.mjs --changed <base index>     every entry of index.json added or moved since <base index>,
//                                                    fetched at its commit as data
//
// Prints JSON and exits 1 when anything is high. A scan says what it found, never that an item is safe: what it
// finds goes to the review (POLICIES/review-standard.md), which reads the whole item.
//
// Each finding: { severity: 'high' | 'medium' | 'low', rule, file, line?, quote }.
import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { extname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ severity: 'high' | 'medium' | 'low', rule: string, file: string, line?: number, quote: string }} Finding */

/* the characters a person does not see and an agent reads */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;
const INVISIBLE_ALL = new RegExp(INVISIBLE.source, 'gu');
/* the controls that reorder text, so code reads one way and runs another */
const BIDI = /[\u202A-\u202E\u2066-\u2069]/u;
/* a zero-width joiner between two pictographs is part of an emoji, not something hidden */
const EMOJI_JOIN = /\p{Extended_Pictographic}\uFE0F?\u200D(?=\p{Extended_Pictographic})/gu;

const CODE = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.py', '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.psm1', '.bat', '.cmd', '.rb', '.pl', '.php', '.lua', '.html', '.htm', '.svg', '.vbs', '.applescript', '.scpt']);
const PAGE = new Set(['.html', '.htm', '.svg']);
/* more than any item's text should be; past this, a file is read only in part */
const MAX_TEXT = 4 * 1024 * 1024;

/** A rule: where it applies, the pattern, how bad, and the words for the reviewer. */
const rule = (/** @type {string} */ id, /** @type {Finding['severity']} */ severity, /** @type {RegExp} */ re, /** @type {(f: FileInfo) => boolean} */ where) => ({ id, severity, re, where });
/** @typedef {{ path: string, ext: string, code: boolean, page: boolean, markdown: boolean, brief: boolean }} FileInfo */
const anyText = () => true;
const inCode = (/** @type {FileInfo} */ f) => f.code;
const inProse = (/** @type {FileInfo} */ f) => !f.code;

const RULES = [
  /* words that turn an agent against the person it works for */
  rule('prompt-injection', 'high', /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|preceding|all|any|other|system|your|the user'?s?)\b[^.\n]{0,25}\b(?:instructions?|prompts?|rules|guidelines|directions|messages|context|guardrails|restrictions)\b/i, anyText),
  rule('prompt-injection', 'high', /\b(?:do\s+not|don'?t|never|without)\s+(?:tell(?:ing)?|inform(?:ing)?|mention(?:ing)?|reveal(?:ing)?|show(?:ing)?|notify(?:ing)?|ask(?:ing)?|alert(?:ing)?|let(?:ting)?)\s+(?:the\s+|your\s+)?(?:user|person|human|owner|people)\b/i, anyText),
  rule('prompt-injection', 'high', /\b(?:keep|hide)\b[^.\n]{0,30}\b(?:secret|hidden)\b[^.\n]{0,20}\bfrom\s+(?:the\s+)?(?:user|person|human)\b/i, anyText),
  rule('prompt-injection', 'high', /\b(?:the\s+)?(?:user|person|owner)\s+(?:has\s+)?(?:already\s+)?(?:authori[sz]ed|approved|consented\s+to|agreed\s+to|pre-?approved)\b/i, anyText),
  rule('prompt-injection', 'high', /\b(?:you\s+are\s+now|your\s+new\s+(?:role|instructions|task)\s+(?:is|are)|from\s+now\s+on,?\s+you\s+(?:must|will|are))\b/i, anyText),
  rule('prompt-injection', 'high', /\b(?:send|upload|post|forward|transmit|exfiltrate|e-?mail|beacon|report)\b[^\n]{0,80}?\b(?:to|into)\s+(?:https?:\/\/|wss?:\/\/|[\w.+-]+@[\w-]+\.[\w.-]+|(?:an?|this|that|the\s+following|my|our)\s+(?:url|address|endpoint|server|webhook|inbox|e-?mail))/i, inProse),
  rule('prompt-injection', 'medium', /<\/?\s*(?:system|assistant|instructions?|admin)\s*>|\[\s*(?:system|admin)\s*\]|BEGIN\s+SYSTEM\s+PROMPT|###\s*system\b/i, anyText),
  /* commands a person is told to paste, or an agent to run, before anything else */
  rule('paste-command', 'high', /\b(?:curl|wget|fetch|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n|]{0,300}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh|fish|python3?|node|perl|ruby|iex|invoke-expression|powershell|pwsh)\b/i, anyText),
  rule('paste-command', 'high', /(?:\b(?:ba|z)?sh\s+(?:-c\s+)?["']?\$\(\s*(?:curl|wget)|<\(\s*(?:curl|wget)\b|\bbase64\s+(?:-d|--decode|-D)\b[^\n]{0,80}\|\s*(?:sh|bash|zsh|python3?|node)\b)/i, anyText),
  rule('paste-command', 'high', /\b(?:invoke-expression|iex)\s*\(|\bxattr\s+-[a-z]*d[a-z]*\s+com\.apple\.quarantine\b|\bspctl\s+--master-disable\b/i, anyText),
  rule('paste-command', 'high', /\b(?:run|paste|execute|enter|type)\b\s+(?:this|these|the\s+following)\b[^.\n]{0,40}\b(?:first|before)\b|\b(?:open|launch)\s+(?:a|your|the)\s+(?:terminal|command\s+prompt|shell|console)\s+and\s+(?:run|paste|type|enter)\b|\bpaste\s+(?:this|it|the\s+following)\s+(?:in|into)\s+(?:a|your|the)\s+(?:terminal|shell|console|command\s+prompt)\b|\bprerequisites?\b[^.\n]{0,60}\b(?:curl|wget|paste|run\s+this)\b/i, inProse),
  /* places that hold a person's secrets: keys, keychains, browser profiles */
  rule('secrets-access', 'high', /~[\\/]\.ssh\b|['"`\\/]\.ssh(?:['"`\\/]|\b)|\bid_(?:rsa|dsa|ecdsa|ed25519)\b|\bauthorized_keys\b|\.aws[\\/]credentials|['"`\\/]\.aws['"`\\/]|\.netrc\b|['"`\\/]\.gnupg\b|\.docker[\\/]config\.json|\.kube[\\/]config|\.config[\\/]gh[\\/]hosts/i, anyText),
  rule('secrets-access', 'high', /Library[\\/]Keychains|\blogin\.keychain|\bsecurity\s+(?:find-(?:generic|internet)-password|dump-keychain|export)\b|['"`](?:find-(?:generic|internet)-password|dump-keychain)['"`]|\bkeyring\.get_password\b|\bCredRead\b|\bcmdkey\s+\/list\b|\bvaultcmd\b/i, anyText),
  rule('secrets-access', 'high', /['"`\\/](?:Login Data|Web Data|Local State|Cookies(?:\.binarycookies)?|logins\.json|key[34]\.db|cookies\.sqlite|formhistory\.sqlite)['"`]|User Data[\\/](?:Default|Profile \d+)|\bwallet\.dat\b|[\\/]Local Storage[\\/]leveldb/, anyText),
  /* code that cannot be read, or runs what it was not shipped with */
  rule('eval', 'high', /(?<![.\w$])eval\s*\(|\bnew\s+Function\s*\(|(?<![.\w$])Function\s*\(\s*['"`\w]|\bset(?:Timeout|Interval)\s*\(\s*['"`]|\bvm\.(?:runIn\w*Context|Script|compileFunction)\b|\bimport\s*\(\s*(?:['"`](?:https?|data):|`[^`]*\$\{)|\b__import__\s*\(|\bimportlib\.import_module\s*\(\s*[^'"]/, inCode),
  rule('eval', 'high', /(?<![.\w$])(?:exec|execfile)\s*\(|\bcompile\s*\([^)]*['"]exec['"]/, (f) => f.ext === '.py'),
  rule('child-process-built-string', 'high', /(?<![\w$.])(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|['"][^'"\n]*['"]\s*\+|[A-Za-z_$][\w$.[\]]*\s*[,)+])|\b(?:child_process|cp|childProcess|proc)\.(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|['"][^'"\n]*['"]\s*\+|[A-Za-z_$][\w$.[\]]*\s*[,)+])|\bshell\s*:\s*true\b|\bshell\s*=\s*True\b|\bos\.(?:system|popen)\s*\(|\bcommands\.getoutput\s*\(|\bRuntime\.getRuntime\(\)\.exec\b/, inCode),
  rule('child-process', 'low', /\bchild_process\b|\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(|\bsubprocess\.\w+\s*\(|\bDeno\.(?:run|Command)\b|\bBun\.spawn\b/, inCode),
  rule('download-executable', 'high', /https?:\/\/[^\s'"`<>)]+\.(?:exe|msi|dmg|pkg|app|dll|dylib|so|bin|elf|appimage|deb|rpm|run|scr|bat|cmd|ps1|sh|command|jar|whl|node)(?:[?#'"`\s)]|$)/i, anyText),
  rule('download-executable', 'medium', /\bchmod\s+(?:[+ugoa]*\+x|[0-7]?7[0-7][0-7])\b|\bchmod(?:Sync)?\s*\([^)]*,\s*0o?7[0-7][0-7]\b|\bos\.chmod\s*\([^)]*0o7[0-7][0-7]|\bstat\.S_IX(?:USR|GRP|OTH)\b/, inCode),
  rule('runtime-install', 'high', /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci)\b|\bnpx\s+(?:-y\b|--yes\b)|\bpip3?\s+install\b|\b-m\s+pip\s+install\b|\buv\s+(?:pip\s+install|add|tool\s+install)\b|\b(?:gem|cargo|go)\s+install\b|\bbrew\s+install\b|\b(?:apt|apt-get|yum|dnf|apk|pacman|choco|winget|scoop)\s+(?:-\w+\s+)*(?:install|add|-S)\b/, inCode),
  rule('runtime-install', 'medium', /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\s+\S|\bpip3?\s+install\s+\S|\b-m\s+pip\s+install\b|\b(?:gem|cargo|go)\s+install\s+\S/, inProse),
  rule('env-dump', 'high', /\b(?:JSON\.stringify|Object\.(?:keys|entries|values|assign|fromEntries))\s*\(\s*(?:\{\s*\}\s*,\s*)?(?:process\.env|Deno\.env\.toObject\(\)|Bun\.env)\b|\bjson\.dumps\s*\(\s*(?:dict\s*\(\s*)?os\.environ\b|\bos\.environ\.(?:items|keys|values|copy)\s*\(\s*\)|\bfor\s+\w+(?:\s*,\s*\w+)?\s+(?:in|of)\s+(?:Object\.\w+\()?(?:os\.environ|process\.env)\b|(?:^|[;&|]\s*)(?:printenv|env|set)\s*(?:\||>)|\bGet-ChildItem\s+env:/m, inCode),
  rule('obfuscation', 'high', /\b_0x[0-9a-f]{4,}\b|(?:\\x[0-9a-fA-F]{2}){24,}|(?:\\u[0-9a-fA-F]{4}){16,}|\bString\.fromCharCode\s*\(\s*(?:\d+\s*,\s*){12,}|\b(?:atob|unescape)\s*\(\s*['"`][A-Za-z0-9+/=%]{40,}|\bBuffer\.from\s*\(\s*['"`][A-Za-z0-9+/=]{40,}['"`]\s*,\s*['"`](?:base64|hex)|\b(?:b64decode|decodebytes|codecs\.decode)\s*\(\s*b?['"][A-Za-z0-9+/=]{40,}/, inCode),
];

/* a run of base64 or hex too long to be read, which hides what it holds */
const BLOB = /[A-Za-z0-9+/]{200,}={0,2}|[0-9a-fA-F]{200,}/g;
/* a picture, a font or a sound inlined in a page is a blob too, but one that shows what it is */
const INLINE_MEDIA = /data:(?:image|font|audio|video)\/[\w.+-]+(?:;[\w=.-]+)*;base64,$/i;
/* how long a line of code gets before it cannot be read */
const LONG_LINE = 1000;
const MINIFIED_LINE = 4000;

/* hosts code names that are no network use: examples, this computer, namespaces */
const NOT_NETWORK = /^(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1?\]|(?:[\w-]+\.)*(?:example\.(?:com|org|net)|test|localhost|invalid|local)|(?:www\.)?w3\.org|json-schema\.org)$/i;
const URL_IN_CODE = /\b(?:https?|wss?):\/\/([a-z0-9.-]+\.[a-z]{2,63}|localhost|\[[0-9a-f:]+\]|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?/gi;
const HOST = /^(\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** What a finding quotes: one line, at most 200 characters, with every invisible character spelled out. */
function quoteOf(/** @type {string} */ text) {
  const shown = text.replace(INVISIBLE_ALL, (c) => `<U+${c.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}>`).trim();
  return shown.length > 200 ? `${shown.slice(0, 197)}...` : shown;
}

/** Every file in a folder, by its path inside it; links reported and not followed. @param {string} dir */
function walk(dir, base = '', out = /** @type {{ path: string, link: boolean }[]} */ ([])) {
  for (const e of readdirSync(join(dir, base), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = posix.join(base, e.name);
    if (e.isSymbolicLink()) out.push({ path, link: true });
    else if (e.isDirectory()) { if (e.name !== '.git') walk(dir, path, out); }
    else if (e.isFile()) out.push({ path, link: false });
  }
  return out;
}

/** Whether bytes are a program for some computer: an executable or a library, by its first bytes. @param {Buffer} b */
function executableKind(b) {
  if (b.length < 4) return null;
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return 'ELF';
  if (b[0] === 0x4d && b[1] === 0x5a) return 'PE';
  const m = b.readUInt32BE(0);
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m)) return 'Mach-O';
  if (b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d) return 'WebAssembly';
  return null;
}

/** The domains an openfilm.json declares, as the app reads them. @param {any} json */
function declaredDomains(json) {
  const domains = json?.permissions?.network?.domains;
  return Array.isArray(domains) ? domains.filter((d) => typeof d === 'string').map((d) => d.trim().toLowerCase()) : [];
}

/** Whether a host is one the declared domains let a page reach. @param {string} host @param {string[]} domains */
const covered = (host, domains) => domains.some((d) => (d.startsWith('*.') ? host.endsWith(d.slice(1)) && host.length > d.length - 1 : host === d));

/** Whether a line of code is a comment, where a link is for people to read. @param {string} line @param {number} at */
function inComment(line, at) {
  const before = line.slice(0, at);
  if (/^\s*(?:\/\/|#(?!!)|\*|\/\*|<!--|--|;|rem\b)/i.test(line)) return true;
  const slash = before.search(/(?:^|[\s;,)])\/\/\s/);
  return slash >= 0 && ((before.slice(0, slash).match(/['"`]/g)?.length ?? 0) % 2 === 0);
}

/**
 * Reads a folder and says what it found. Nothing in it is run.
 * @param {string} dir @param {{ openfilmJson?: any }} [options] the item's openfilm.json, when not the folder's own
 * @returns {Finding[]}
 */
export function scanFolder(dir, { openfilmJson } = {}) {
  /** @type {Finding[]} */
  const findings = [];
  const seen = new Set();
  const add = (/** @type {Finding} */ f) => {
    const key = `${f.rule}\0${f.file}\0${f.line ?? ''}`;
    if (!seen.has(key)) { seen.add(key); findings.push(f); }
  };

  let json = openfilmJson;
  if (json === undefined) { try { json = JSON.parse(readFileSync(join(dir, 'openfilm.json'), 'utf8')); } catch { json = undefined; } }
  const network = json?.permissions?.network;
  const domains = declaredDomains(json);
  if (network !== undefined) {
    const raw = Array.isArray(network?.domains) ? network.domains : null;
    const bad = raw ? raw.filter((d) => typeof d !== 'string' || !HOST.test(d.trim().toLowerCase())) : [];
    if (!raw || !raw.length || bad.length || raw.length > 20) {
      add({ severity: 'high', rule: 'permissions-network-invalid', file: 'openfilm.json',
        quote: quoteOf(JSON.stringify(network)) });
    }
  }
  /** @type {Map<string, { file: string, line: number, quote: string, page: boolean }>} */
  const hosts = new Map();

  for (const { path, link } of walk(dir)) {
    if (link) {
      add({ severity: 'high', rule: 'symlink', file: path, quote: 'a link to somewhere else: an item holds its own files' });
      continue;
    }
    const full = join(dir, path);
    const size = lstatSync(full).size;
    const bytes = readFileSync(full);
    const head = bytes.subarray(0, 8192);
    const exe = executableKind(bytes);
    if (exe) { add({ severity: 'high', rule: 'binary-executable', file: path, quote: `a compiled ${exe} program: code is shipped as source` }); continue; }
    if (head.includes(0)) continue;
    const ext = extname(path).toLowerCase();
    let text = bytes.subarray(0, MAX_TEXT).toString('utf8');
    if (size > MAX_TEXT) add({ severity: 'medium', rule: 'large-text', file: path, quote: `${size} bytes: only the first ${MAX_TEXT} were read` });
    const shebang = text.startsWith('#!');
    /** @type {FileInfo} */
    const file = { path, ext, code: CODE.has(ext) || shebang, page: PAGE.has(ext), markdown: ext === '.md' || ext === '.markdown',
      brief: posix.basename(path).toLowerCase() === 'skill.md' };
    const lines = text.split(/\r?\n/);

    /* npm's own scripts run when someone installs a package: none may */
    if (posix.basename(path) === 'package.json') {
      let pkg;
      try { pkg = JSON.parse(text); } catch { pkg = null; }
      for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'preprepare', 'postprepare']) {
        if (typeof pkg?.scripts?.[hook] === 'string') {
          add({ severity: 'high', rule: 'install-script', file: path, line: lineOf(lines, `"${hook}"`), quote: quoteOf(`"${hook}": ${JSON.stringify(pkg.scripts[hook])}`) });
        }
      }
      for (const deps of ['dependencies', 'optionalDependencies']) {
        if (pkg?.[deps] && Object.keys(pkg[deps]).length) {
          add({ severity: 'low', rule: 'dependencies', file: path, line: lineOf(lines, `"${deps}"`), quote: quoteOf(`${deps}: ${Object.keys(pkg[deps]).join(', ')}`) });
        }
      }
    }

    let fenced = false;
    let comment = false;
    lines.forEach((line, i) => {
      const n = i + 1;
      /* what a person does not see */
      const visible = line.replace(EMOJI_JOIN, (m) => m.replace('\u200D', ''));
      const hidden = [...visible.matchAll(INVISIBLE_ALL)];
      if (hidden.length) {
        /* a byte-order mark opening a file is an editor's; in code, only text-direction controls hide what runs */
        const onlyBom = hidden.length === 1 && n === 1 && visible.startsWith('\uFEFF');
        const bidi = hidden.some((m) => BIDI.test(m[0]));
        add({ severity: onlyBom ? 'low' : file.code && !bidi ? 'medium' : 'high', rule: 'invisible-character', file: path, line: n, quote: quoteOf(line) });
      }
      /* what an agent reads in a brief and a person never sees rendered */
      if (file.markdown) {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        const opens = !fenced && line.includes('<!--');
        if (comment || opens) {
          add({ severity: file.brief ? 'medium' : 'low', rule: 'html-comment', file: path, line: n, quote: quoteOf(line) });
          comment = line.includes('-->') ? line.lastIndexOf('<!--') > line.lastIndexOf('-->') : true;
        }
      }
      for (const r of RULES) {
        if (!r.where(file)) continue;
        const m = r.re.exec(line);
        if (m) add({ severity: r.severity, rule: r.id, file: path, line: n, quote: quoteOf(line) });
      }
      for (const m of line.matchAll(BLOB)) {
        const before = line.slice(Math.max(0, (m.index ?? 0) - 80), m.index);
        const media = INLINE_MEDIA.test(before);
        add({ severity: media ? 'low' : 'high', rule: 'encoded-blob', file: path, line: n,
          quote: quoteOf(`${media ? 'inline media, ' : ''}${m[0].length} characters: ${m[0].slice(0, 60)}...`) });
      }
      if (file.code && line.length > LONG_LINE) {
        add({ severity: line.length > MINIFIED_LINE ? 'high' : 'medium', rule: 'obfuscation', file: path, line: n,
          quote: quoteOf(`a line of ${line.length} characters: ${line.slice(0, 120)}`) });
      }
      if (file.code) {
        for (const u of line.matchAll(URL_IN_CODE)) {
          const host = u[1].toLowerCase();
          if (NOT_NETWORK.test(host) || inComment(line, u.index ?? 0)) continue;
          /* a link a person follows leaves the page; it is not the page reaching out */
          if (file.page && /<a\s[^>]*href\s*=\s*["']?$/i.test(line.slice(0, u.index))) continue;
          if (!hosts.has(host)) hosts.set(host, { file: path, line: n, quote: quoteOf(line), page: file.page });
        }
      }
    });
  }

  for (const [host, at] of hosts) {
    if (covered(host, domains)) continue;
    add({ severity: at.page ? 'medium' : 'high', rule: 'network-undeclared', file: at.file, line: at.line,
      quote: quoteOf(`${host} is not in permissions.network.domains: ${at.quote}`) });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line ?? 0) - (b.line ?? 0)));
}

/** The line a piece of text is first on, from 1. @param {string[]} lines @param {string} text */
function lineOf(lines, text) {
  const i = lines.findIndex((l) => l.includes(text));
  return i < 0 ? 1 : i + 1;
}

/**
 * The entries of an index added, or pinned to another commit, since a base index.
 * @param {any} base @param {any} index @returns {{ name: string, repo: string, path: string, version: string, commit: string, previous?: string }[]}
 */
export function changedEntries(base, index) {
  const before = new Map((Array.isArray(base?.skills) ? base.skills : []).map((/** @type {any} */ s) => [`${s?.repo} ${s?.name}`, s?.commit]));
  return (Array.isArray(index?.skills) ? index.skills : []).flatMap((/** @type {any} */ s) => {
    if (!s || typeof s !== 'object') return [];
    const previous = before.get(`${s.repo} ${s.name}`);
    if (previous === s.commit) return [];
    return [{ ...s, ...(typeof previous === 'string' ? { previous } : {}) }];
  });
}

/** Whether an index entry is one that can be fetched as data: a GitHub repository, a whole commit, a skill's path. @param {any} e */
export const fetchable = (e) => typeof e?.repo === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(e.repo)
  && typeof e.commit === 'string' && /^[0-9a-f]{40}$/.test(e.commit)
  && typeof e.name === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.name) && e.path === `skills/${e.name}`;
