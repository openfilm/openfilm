// A label in the corner of every page of the engine suite: which technique, and whether it worked. The same words are
// kept as window.__probe for the suite to read (`ok`, `label`, and whatever else a page adds).
export function label(text, ok = true, extra = {}) {
  let el = document.getElementById('probe-label');
  if (!el) {
    el = document.createElement('div');
    el.id = 'probe-label';
    el.style.cssText = 'position:fixed;left:40px;top:34px;z-index:9;font:600 30px/1.3 ui-monospace,Menlo,monospace;padding:10px 18px;border-radius:10px;background:rgba(0,0,0,.72);color:#fff;max-width:1800px;white-space:pre-wrap';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.color = ok ? '#7dffb2' : '#ff8a7a';
  window.__probe = { ...window.__probe, ...extra, label: text, ok };
}
