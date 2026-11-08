/** Audio previews have their own intent: `play` can fire long before any audio can be heard. */
export type Playable = { id: string; durationMs?: number };
export type PreviewError = 'unavailable' | 'timeout';
export interface PreviewState<T extends Playable> {
  item: T | null;
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  slow: boolean;
  error: PreviewError | null;
  /** Metadata is available: the local file endpoint has finished preparing this media. */
  ready: boolean;
  time: number;
  duration: number;
}

/* Sounds, music and voices have separate panels, but only one of them may be heard. */
let stopActive: (() => void) | null = null;

export function createPreviewPlayer<T extends Playable>({
  makeAudio = (src: string) => new Audio(src),
  onReady = (_id: string) => {},
  slowMs = 5000,
  timeoutMs = 20_000,
} = {}) {
  let state: PreviewState<T> = { item: null, status: 'idle', slow: false, error: null, ready: false, time: 0, duration: 0 };
  let audio: HTMLAudioElement | null = null;
  let source = '';
  let wanted = false;
  let round = 0;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<PreviewState<T>>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };
  const clearWait = () => {
    clearTimeout(slowTimer); clearTimeout(timeout);
    slowTimer = timeout = undefined;
  };
  const release = () => {
    round += 1;
    clearWait();
    wanted = false;
    const was = audio;
    audio = null;
    if (stopActive === stop) stopActive = null;
    if (was) { was.pause(); was.removeAttribute('src'); was.load(); }
  };
  const fail = (a: HTMLAudioElement, error: PreviewError) => {
    if (audio !== a || !wanted) return;
    release();
    update({ status: 'error', slow: false, error });
  };
  const loading = (a: HTMLAudioElement) => {
    if (audio !== a || !wanted || timeout !== undefined) return;
    update({ status: 'loading', slow: false, error: null });
    slowTimer = setTimeout(() => { if (audio === a && wanted) update({ slow: true }); }, slowMs);
    timeout = setTimeout(() => fail(a, 'timeout'), timeoutMs);
  };
  const pause = () => {
    if (!audio) return;
    const pending = state.status === 'loading';
    wanted = false;
    round += 1;
    clearWait();
    if (pending) release(); else audio.pause();
    update({ status: 'paused', slow: false });
  };
  function stop() {
    if (!audio) return;
    const time = audio.currentTime;
    release();
    update({ status: 'paused', slow: false, time });
  }
  const play = (a: HTMLAudioElement) => {
    if (stopActive !== stop) stopActive?.();
    stopActive = stop;
    wanted = true;
    const attempt = ++round;
    loading(a);
    try {
      void a.play().catch(() => { if (attempt === round) fail(a, 'unavailable'); });
    } catch { fail(a, 'unavailable'); }
  };
  const toggle = (next: T, src: string) => {
    const same = state.item?.id === next.id;
    if (same && wanted) { pause(); return; }
    if (same && audio) { play(audio); return; }
    const resume = same ? state.time : 0;
    release();
    source = src;
    const a = makeAudio(source);
    audio = a;
    update({ item: next, status: 'loading', slow: false, error: null, ready: false, time: resume, duration: (next.durationMs ?? 0) / 1000 });
    a.onloadedmetadata = () => {
      if (audio !== a) return;
      onReady(next.id);
      update({ ready: true, ...(Number.isFinite(a.duration) ? { duration: a.duration } : {}) });
      if (resume > 0) a.currentTime = resume;
    };
    a.onplaying = () => {
      if (audio !== a || !wanted) return;
      clearWait();
      update({ status: 'playing', slow: false, error: null });
    };
    a.onwaiting = () => loading(a);
    a.onstalled = () => { if (a.readyState < 3) loading(a); };
    a.onpause = () => {
      if (audio !== a || !wanted || !a.paused) return;
      wanted = false;
      round += 1;
      clearWait();
      update({ status: 'paused', slow: false });
    };
    a.onended = () => {
      if (audio !== a) return;
      wanted = false;
      round += 1;
      clearWait();
      a.currentTime = 0;
      update({ status: 'paused', time: 0, slow: false });
    };
    a.onerror = () => fail(a, 'unavailable');
    play(a);
  };
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    toggle: (item: T, src?: string) => toggle(item, src ?? source),
    pause,
    tick: () => { if (audio && state.time !== audio.currentTime) update({ time: audio.currentTime }); },
    seek: (sec: number) => {
      if (!audio || state.status === 'loading' || state.status === 'error') return;
      audio.currentTime = Math.max(0, Math.min(state.duration, sec));
      update({ time: audio.currentTime });
    },
    close: () => {
      release();
      source = '';
      update({ item: null, status: 'idle', slow: false, error: null, ready: false, time: 0, duration: 0 });
    },
  };
}
