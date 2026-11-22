// The Browser workbench: the address field, the tabs, and the room a web page is shown in. The page itself is not in
// this page: the desktop app draws it in a process of its own, over the room this element leaves (`place`), so no site
// shares anything with Studio. Every address and title shown here is the app's own reading of the tab, never the
// site's word. In Studio in a browser there is no such app: the element says so.
//
// The app's page lies over this one, so whatever of Studio's opens over the room (a menu, a dialog) would be hidden
// behind it: while anything covers the room, the web page steps aside (`place(null)`) and comes back after.

const WORDS = {
  en: { field: 'Search or enter an address', back: 'Back', forward: 'Forward', reload: 'Reload', stop: 'Stop', newTab: 'New tab', close: 'Close tab', untitled: 'New Tab',
    secure: 'The connection is private', insecure: 'Not secure: others on the network can read this page', local: 'On this computer or its network',
    start: 'Go anywhere on the web', startHint: 'Sites are kept apart from your projects and from this computer.',
    refused: 'OpenFilm doesn’t open this address', refusedHint: 'Web pages over http and https open here. Files, the app’s own pages and other apps’ links do not.',
    cert: 'The connection to {host} isn’t private', certHint: 'The site’s certificate doesn’t check, so the page was not opened. There is no way round this here.',
    unreachable: 'Can’t reach {host}', blocked: 'This page was not allowed to load', crashed: 'This page stopped', again: 'Try Again',
    done: 'Downloaded', failed: 'Not downloaded', showFile: 'Show', desktop: 'The browser comes with the OpenFilm desktop app.' },
  'zh-CN': { field: '搜索或输入网址', back: '后退', forward: '前进', reload: '重新加载', stop: '停止', newTab: '新标签页', close: '关闭标签页', untitled: '新标签页',
    secure: '连接是私密的', insecure: '不安全：同一网络上的人能看到这个页面', local: '这台电脑或它所在的网络',
    start: '去网上任何地方', startHint: '网站与你的项目、这台电脑是隔开的。',
    refused: 'OpenFilm 不打开这个地址', refusedHint: '这里打开 http 和 https 的网页。文件、应用自己的页面和其他应用的链接不行。',
    cert: '与 {host} 的连接不是私密的', certHint: '网站的证书没有通过检查，所以没有打开这个页面。这里没有办法绕过。',
    unreachable: '无法访问 {host}', blocked: '这个页面不被允许加载', crashed: '这个页面停止了', again: '重试',
    done: '已下载', failed: '未下载', showFile: '显示', desktop: '浏览器随 OpenFilm 桌面应用提供。' },
  ja: { field: '検索またはアドレスを入力', back: '戻る', forward: '進む', reload: '再読み込み', stop: '中止', newTab: '新しいタブ', close: 'タブを閉じる', untitled: '新しいタブ',
    secure: '接続は保護されています', insecure: '保護されていません：同じネットワークの人がこのページを読めます', local: 'このコンピュータまたはそのネットワーク',
    start: 'ウェブのどこへでも', startHint: 'サイトはプロジェクトやこのコンピュータから切り離されています。',
    refused: 'OpenFilm はこのアドレスを開きません', refusedHint: 'ここでは http と https のページを開きます。ファイル、アプリ自身のページ、ほかのアプリのリンクは開きません。',
    cert: '{host} への接続は保護されていません', certHint: 'サイトの証明書を確認できないため、ページを開きませんでした。ここでは回避できません。',
    unreachable: '{host} に接続できません', blocked: 'このページは読み込めませんでした', crashed: 'このページは停止しました', again: '再試行',
    done: 'ダウンロード済み', failed: 'ダウンロードできませんでした', showFile: '表示', desktop: 'ブラウザは OpenFilm デスクトップアプリに付属します。' },
  ko: { field: '검색하거나 주소 입력', back: '뒤로', forward: '앞으로', reload: '새로 고침', stop: '중지', newTab: '새 탭', close: '탭 닫기', untitled: '새 탭',
    secure: '연결이 비공개입니다', insecure: '안전하지 않음: 같은 네트워크의 다른 사람이 이 페이지를 읽을 수 있습니다', local: '이 컴퓨터 또는 그 네트워크',
    start: '웹 어디로든', startHint: '사이트는 프로젝트와 이 컴퓨터에서 분리되어 있습니다.',
    refused: 'OpenFilm은 이 주소를 열지 않습니다', refusedHint: '여기서는 http와 https 페이지를 엽니다. 파일, 앱 자체의 페이지, 다른 앱의 링크는 열지 않습니다.',
    cert: '{host}에 대한 연결이 비공개가 아닙니다', certHint: '사이트의 인증서가 확인되지 않아 페이지를 열지 않았습니다. 여기서는 우회할 수 없습니다.',
    unreachable: '{host}에 연결할 수 없습니다', blocked: '이 페이지는 불러올 수 없습니다', crashed: '이 페이지가 멈췄습니다', again: '다시 시도',
    done: '다운로드됨', failed: '다운로드되지 않음', showFile: '보기', desktop: '브라우저는 OpenFilm 데스크톱 앱에 포함되어 있습니다.' },
  es: { field: 'Busca o escribe una dirección', back: 'Atrás', forward: 'Adelante', reload: 'Recargar', stop: 'Detener', newTab: 'Pestaña nueva', close: 'Cerrar pestaña', untitled: 'Pestaña nueva',
    secure: 'La conexión es privada', insecure: 'No es segura: otros en la red pueden leer esta página', local: 'En este ordenador o su red',
    start: 'Ve a cualquier lugar de la web', startHint: 'Los sitios se mantienen aparte de tus proyectos y de este ordenador.',
    refused: 'OpenFilm no abre esta dirección', refusedHint: 'Aquí se abren páginas web por http y https. Los archivos, las páginas de la app y los enlaces de otras apps, no.',
    cert: 'La conexión con {host} no es privada', certHint: 'El certificado del sitio no es válido, así que la página no se abrió. Aquí no hay forma de saltárselo.',
    unreachable: 'No se puede acceder a {host}', blocked: 'No se permitió cargar esta página', crashed: 'Esta página se detuvo', again: 'Reintentar',
    done: 'Descargado', failed: 'No descargado', showFile: 'Mostrar', desktop: 'El navegador viene con la app de escritorio de OpenFilm.' },
};

const ICONS = {
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  stop: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  secure: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  insecure: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  local: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  none: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
};
const icon = (name, size = 15) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const STYLE = `
/* Studio lays the element out itself (a block that takes the room there is): what it holds fills it */
:host { position: relative; background: var(--bg-panel, #1e1e1e); color: var(--text, #eee); font: 12px/1.4 var(--font-sans, system-ui, sans-serif); }
.frame { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
button { all: unset; display: grid; place-items: center; box-sizing: border-box; cursor: default; color: var(--text-dim, #aaa); border-radius: 5px; }
button:hover:not(:disabled) { background: var(--bg-hover, rgba(128,128,128,.18)); color: var(--text, #eee); }
button:disabled { opacity: .35; }
button:focus-visible { outline: 1.5px solid var(--accent, #0a84ff); }
.tabs { display: flex; align-items: stretch; gap: 2px; padding: 5px 6px 0; min-height: 0; overflow: hidden; }
.tabs:empty { display: none; }
.tab { display: flex; align-items: center; gap: 6px; min-width: 60px; max-width: 200px; flex: 0 1 200px; height: 26px; padding: 0 4px 0 9px; border-radius: 6px 6px 0 0; color: var(--text-dim, #aaa); }
.tab[aria-selected='true'] { background: var(--bg-field, rgba(128,128,128,.16)); color: var(--text, #eee); }
.tab span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tab .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--accent, #0a84ff); animation: pulse 1s ease-in-out infinite; }
.tab button { flex: none; width: 18px; height: 18px; }
@keyframes pulse { 50% { opacity: .25; } }
.bar { display: flex; align-items: center; gap: 2px; padding: 6px; border-bottom: 1px solid var(--border, rgba(128,128,128,.25)); }
.bar > button { width: 26px; height: 26px; flex: none; }
form { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; height: 26px; margin: 0 4px; padding: 0 9px; border-radius: 13px; background: var(--bg-field, rgba(128,128,128,.16)); box-shadow: inset 0 0 0 1px transparent; }
form:focus-within { background: var(--bg-panel, #1e1e1e); box-shadow: inset 0 0 0 1.5px var(--accent, #0a84ff); }
form .state { display: grid; place-items: center; flex: none; color: var(--text-faint, #888); }
form .state[data-state='insecure'] { color: var(--warn, #ff9f0a); }
input { all: unset; flex: 1; min-width: 0; color: var(--text, #eee); font: inherit; }
input::placeholder { color: var(--text-faint, #888); }
.room { position: relative; flex: 1; min-height: 0; background: var(--bg-app, #141414); }
.note { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 24px; text-align: center; }
.note h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text, #eee); overflow-wrap: anywhere; }
.note p { margin: 0; max-width: 420px; color: var(--text-dim, #aaa); overflow-wrap: anywhere; }
.note code { font: 11px var(--font-mono, ui-monospace, monospace); color: var(--text-faint, #888); overflow-wrap: anywhere; }
.note button { margin-top: 6px; padding: 5px 14px; background: var(--bg-field, rgba(128,128,128,.16)); color: var(--text, #eee); }
.downloads { display: flex; gap: 14px; padding: 5px 10px; border-top: 1px solid var(--border, rgba(128,128,128,.25)); color: var(--text-dim, #aaa); overflow: hidden; white-space: nowrap; }
.downloads:empty { display: none; }
.downloads button { display: inline; padding: 0 5px; color: var(--accent, #0a84ff); }
`;

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Chromium's certificate errors (net::ERR_CERT_*) */
const certError = (code) => typeof code === 'number' && code <= -200 && code >= -219;

export default class OpenFilmBrowser extends HTMLElement {
  constructor() {
    super();
    this.native = globalThis.openfilmNative?.browser ?? null;
    this.shown = { active: null, tabs: [], downloads: [] };
    this.placedAs = '';
    this.attachShadow({ mode: 'open' }).innerHTML = `<style>${STYLE}</style><div class="frame"><div class="tabs" role="tablist"></div><div class="bar"></div><div class="room"></div><div class="downloads"></div></div>`;
  }

  get words() { return WORDS[document.documentElement.lang] ?? WORDS.en; }
  get tab() { return this.shown.tabs.find((t) => t.id === this.shown.active) ?? null; }

  connectedCallback() {
    const root = this.shadowRoot;
    const w = this.words;
    if (!this.native) { root.querySelector('.room').innerHTML = `<div class="note"><p>${escape(w.desktop)}</p></div>`; return; }
    root.querySelector('.bar').innerHTML = `
      <button data-do="back" title="${escape(w.back)}" aria-label="${escape(w.back)}">${icon('back', 17)}</button>
      <button data-do="forward" title="${escape(w.forward)}" aria-label="${escape(w.forward)}">${icon('forward', 17)}</button>
      <button data-do="reload"></button>
      <form><span class="state"></span><input type="text" inputmode="url" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="${escape(w.field)}" aria-label="${escape(w.field)}"></form>
      <button data-do="new" title="${escape(w.newTab)}" aria-label="${escape(w.newTab)}">${icon('plus', 16)}</button>`;
    this.field = root.querySelector('input');
    root.addEventListener('click', this.onClick);
    root.querySelector('form').addEventListener('submit', this.onSubmit);
    this.field.addEventListener('keydown', this.onFieldKey);
    this.field.addEventListener('focus', () => this.field.select());
    this.field.addEventListener('blur', () => this.drawAddress());
    /* Studio's own keys (Space plays, Delete removes) stay out of what is typed here */
    this.addEventListener('keydown', this.keepKeys);
    this.stops = [
      this.native.onState((next) => { if (next.projectId === this.getAttribute('project-id')) this.take(next); }),
      this.native.onFocusAddress(() => { this.field.focus(); this.field.select(); }),
    ];
    void this.native.state().then((next) => this.take(next), () => {});
    this.watching = true;
    this.watch();
  }

  disconnectedCallback() {
    this.watching = false;
    for (const stop of this.stops ?? []) stop();
    this.stops = [];
    this.shadowRoot.removeEventListener('click', this.onClick);
    this.removeEventListener('keydown', this.keepKeys);
    this.place(null);
  }

  keepKeys = (event) => { if (!event.metaKey && !event.ctrlKey) event.stopPropagation(); };

  onClick = (event) => {
    const button = event.target.closest?.('[data-do]');
    if (!button || button.disabled) return;
    const id = button.dataset.tab ?? this.shown.active;
    const act = button.dataset.do;
    if (act === 'new') { void this.native.open(null); this.field.value = ''; this.field.focus(); }
    else if (act === 'select') void this.native.select(id);
    else if (act === 'close') { event.stopPropagation(); void this.native.close(id); }
    else if (act === 'reload') void (this.tab?.loading ? this.native.stop(id) : this.native.reload(id));
    else if (act === 'reveal') void globalThis.openfilmNative?.revealPath?.(button.dataset.path);
    else if (act === 'back' || act === 'forward') void this.native[act](id);
  };

  onSubmit = (event) => {
    event.preventDefault();
    const text = this.field.value.trim();
    if (!text) return;
    void this.native.go(this.shown.active, text);
    this.field.blur();
    /* the keyboard goes to the page once it is there */
    setTimeout(() => { if (this.shadowRoot.activeElement !== this.field) void this.native.focus(); }, 400);
  };

  onFieldKey = (event) => {
    if (event.key !== 'Escape') return;
    this.field.blur();
    this.drawAddress();
  };

  /** The tabs as the app tells them. */
  take(next) {
    if (!next || !Array.isArray(next.tabs)) return;
    this.shown = next;
    this.draw();
  }

  drawAddress() {
    const address = this.tab?.address ?? { text: '', state: 'none' };
    const state = this.shadowRoot.querySelector('.state');
    const w = this.words;
    state.dataset.state = address.state;
    state.title = { secure: w.secure, insecure: w.insecure, local: w.local }[address.state] ?? '';
    state.innerHTML = icon(address.state in ICONS ? address.state : 'none', 13);
    if (this.shadowRoot.activeElement !== this.field) this.field.value = this.tab?.failed?.address ?? address.text;
  }

  draw() {
    const root = this.shadowRoot;
    const w = this.words;
    const tab = this.tab;
    root.querySelector('.tabs').innerHTML = this.shown.tabs.length < 2 ? '' : this.shown.tabs.map((t) => `
      <div class="tab" role="tab" data-do="select" data-tab="${escape(t.id)}" aria-selected="${t.id === this.shown.active}" title="${escape(t.address.text)}">
        ${t.loading ? '<i class="dot"></i>' : ''}<span>${escape(t.title || t.address.host || w.untitled)}</span>
        <button data-do="close" data-tab="${escape(t.id)}" title="${escape(w.close)}" aria-label="${escape(w.close)}">${icon('stop', 11)}</button>
      </div>`).join('');
    const [back, forward, reload] = root.querySelectorAll('.bar > button');
    back.disabled = !tab?.back;
    forward.disabled = !tab?.forward;
    reload.disabled = !tab || (tab.address.state === 'none' && !tab.failed);
    reload.title = tab?.loading ? w.stop : w.reload;
    reload.setAttribute('aria-label', reload.title);
    reload.innerHTML = icon(tab?.loading ? 'stop' : 'reload', 15);
    this.drawAddress();

    /* what the room says while it holds no page: nothing opened yet, a page that did not open, one that stopped */
    const host = escape(tab?.failed ? (() => { try { return new URL(tab.failed.address).hostname; } catch { return tab.failed.address; } })() : '');
    const note = !tab || (tab.address.state === 'none' && !tab.failed && !tab.loading) ? `<h2>${escape(w.start)}</h2><p>${escape(w.startHint)}</p>`
      : tab.crashed ? `<h2>${escape(w.crashed)}</h2><button data-do="reload">${escape(w.again)}</button>`
        : !tab.failed ? ''
          : tab.failed.code === 'refused' ? `<h2>${escape(w.refused)}</h2><p>${escape(w.refusedHint)}</p>`
            : certError(tab.failed.code) ? `<h2>${escape(w.cert).replace('{host}', host)}</h2><p>${escape(w.certHint)}</p><code>${escape(tab.failed.text)}</code>`
              : tab.failed.code === -20 ? `<h2>${escape(w.blocked)}</h2><code>${escape(tab.failed.text)}</code>`
                : `<h2>${escape(w.unreachable).replace('{host}', host)}</h2><code>${escape(tab.failed.text)}</code><button data-do="reload">${escape(w.again)}</button>`;
    root.querySelector('.room').innerHTML = note ? `<div class="note">${note}</div>` : '';
    root.querySelector('.downloads').innerHTML = this.shown.downloads.slice(-3).map((d) => {
      const said = d.state === 'completed' ? `${escape(w.done)}${d.path ? `<button data-do="reveal" data-path="${escape(d.path)}">${escape(w.showFile)}</button>` : ''}`
        : d.state === 'progressing' ? (d.total > 0 ? `${Math.round((100 * d.received) / d.total)}%` : '…') : escape(w.failed);
      return `<span>${escape(d.name)} · ${said}</span>`;
    }).join('');
  }

  /** Where the web page goes: this room, in the window (null: nowhere). Told only when it changes. */
  place(bounds) {
    const as = bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : '';
    if (as === this.placedAs) return;
    this.placedAs = as;
    void this.native?.place(bounds);
  }

  /** The room followed frame by frame: where it is; and, a few times a second, whether anything lies over it. */
  watch = () => {
    if (!this.watching) return;
    const room = this.shadowRoot.querySelector('.room');
    const r = room.getBoundingClientRect();
    const visible = this.isConnected && r.width >= 40 && r.height >= 40 && getComputedStyle(this).visibility !== 'hidden';
    this.frame = ((this.frame ?? 0) + 1) % 4;
    if (visible && (this.frame === 0 || this.isCovered === undefined)) this.isCovered = this.covered(r);
    this.place(visible && !this.isCovered ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null);
    requestAnimationFrame(this.watch);
  };

  /**
   * Whether something else of the page is in front of the room anywhere. Something large is found on a grid of the
   * room's points; something small (a menu, a list) by looking at what floats over the page: the layers put beside the
   * page's own tree, and menus, dialogs and lists wherever they are. Each is checked where it meets the room, so one
   * that lies under the room, or beside it, does not count.
   */
  covered(r) {
    const over = (x, y) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const top = document.elementFromPoint(x, y);
      return Boolean(top && top !== this && !this.contains(top));
    };
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      if (over(r.left + 4 + ((r.width - 8) * i) / 5, r.top + 4 + ((r.height - 8) * j) / 5)) return true;
    }
    const floating = [...document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [role="tooltip"], [popover]')];
    for (const layer of document.body.children) {
      /* the page's own tree holds this element; the chat's column is a block of the layout, never over the room */
      if (layer.contains(this) || layer.id === 'of-chat' || layer.hidden || layer.tagName === 'SCRIPT' || layer.tagName === 'STYLE') continue;
      floating.push(layer);
      const inside = layer.querySelectorAll('*');
      for (let k = 0; k < inside.length && k < 400; k++) floating.push(inside[k]);
    }
    for (const el of floating) {
      const b = el.getBoundingClientRect();
      const left = Math.max(b.left, r.left), right = Math.min(b.right, r.right), top = Math.max(b.top, r.top), bottom = Math.min(b.bottom, r.bottom);
      if (right - left < 2 || bottom - top < 2) continue;
      if (over((left + right) / 2, (top + bottom) / 2) || over(left + 1, top + 1) || over(right - 1, bottom - 1)) return true;
    }
    return false;
  }
}
