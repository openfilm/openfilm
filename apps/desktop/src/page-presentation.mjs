/** Switch native pages without exposing the empty window between their frames. No Electron dependency. */
export function createPagePresentation({ prepare, present, discard, onError = () => {} }) {
  const pages = new Map();
  const retired = new Set();
  let current = null;
  let wanted = null;

  function remove(id) {
    const page = pages.get(id);
    pages.delete(id);
    retired.delete(id);
    if (page) discard(id, page.view);
  }
  function ensure(id) {
    let page = pages.get(id);
    if (page) return page;
    const prepared = prepare(id);
    page = { view: prepared.view, loaded: false, ready: null };
    pages.set(id, page);
    page.ready = Promise.resolve(prepared.ready).then(() => { page.loaded = true; }, (error) => {
      if (pages.get(id) === page) remove(id);
      onError(error);
      throw error;
    });
    // A preloaded page may never be shown. Its failure must still be handled.
    void page.ready.catch(() => {});
    return page;
  }
  function commit(id, page) {
    if (wanted !== id || retired.has(id) || pages.get(id) !== page) return false;
    present(id, page.view);
    current = id;
    for (const old of [...retired]) if (old !== id) remove(old);
    return true;
  }
  return {
    currentId: () => current,
    wantedId: () => wanted,
    show(id) {
      wanted = id;
      const page = ensure(id);
      // Already painted background pages switch in this call, without a promise turn.
      if (page.loaded) return Promise.resolve(commit(id, page));
      return page.ready.then(() => commit(id, page), () => false);
    },
    warm(id) { return ensure(id).ready.then(() => true, () => false); },
    retire(id) {
      retired.add(id);
      // The outgoing page remains until its replacement is presented.
      if (id !== current) remove(id);
    },
    drop(id) {
      if (id === current || id === wanted) return false;
      remove(id);
      return true;
    },
  };
}

/** The same neighbor close() will choose: right first, otherwise left. */
export function nextClosePage(tabs, home = 'home') {
  const list = tabs.list();
  const at = list.findIndex((tab) => tab.active);
  return list[at + 1]?.id ?? list[at - 1]?.id ?? home;
}

/** Show and raise the replacement before hiding any previously visible page. */
export function revealPage(parent, target, pages) {
  target.setVisible(true);
  parent.addChildView(target);
  for (const page of pages) if (page !== target) page.setVisible(false);
  target.webContents.focus();
}
