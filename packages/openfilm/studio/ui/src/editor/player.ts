/**
 * The film's sound, played with Web Audio, and the clock the picture follows. The picture is drawn in the preview
 * (another origin, see Preview); every sound of the film plays here, so one clock decides where the film is:
 * the audio context's while playing, a number while paused. A browser that will not start the sound yet (no click on
 * the page so far, an embedding app's stricter rules) does not stop the film: the clock is then the page's own, the
 * picture plays silent, and the sound joins as soon as the browser lets it start.
 *
 * `sounds` is the timeline's own list (src/timeline.mjs `__filmSounds`): each sound clip's sound and each video's own,
 * already placed and cut to its clip, with its volume and speed. Each file's sound is fetched small (`?film-sound`, see
 * studio/server/pages.mjs): a video's is a copy of its sound alone, never the whole video. A sound not here yet (its
 * copy still being made) is silent until it is, then joins where the film is.
 *
 * Every sound goes through one mix, metered (`levels`: the audio meters read it while the film plays, nothing reads it
 * paused) before the person's volume. Solo (`setHeard`) leaves the clips of the other tracks out of what plays here
 * only: the film and its exports are as they are.
 */

/** How long play waits for the browser to start the sound before the film plays on without it. */
const RESUME_WAIT_MS = 250;
/** Sounds fetched at once; the others wait, the ones nearest to where the film is first. */
const FETCHES = 3;

/** `fade`: its fades in and out, film seconds, already fitted to its length (src/timeline.mjs). */
export type Sound = { src: string; at: number; from: number; to: number; volume: number; speed: number; clip?: string; fade?: [number, number] };

/**
 * A sound's gain as its fades have it: where it is at `local` seconds into its `length`, then each corner of its ramps
 * after that (the ramp up's end, the ramp down's start, its end), each as [local seconds, gain]. Straight lines between,
 * as the film's mix and its picture have them (src/film-doc.mjs fadeGain).
 */
export function fadeSteps(local: number, length: number, fade: readonly [number, number] | undefined): [number, number][] {
  const gain = (u: number) => {
    if (!fade) return 1;
    let g = 1;
    if (fade[0] > 0) g = Math.min(g, u / fade[0]);
    if (fade[1] > 0) g = Math.min(g, (length - u) / fade[1]);
    return Math.max(0, Math.min(1, g));
  };
  const steps: [number, number][] = [[local, gain(local)]];
  if (!fade) return steps;
  for (const u of [fade[0], length - fade[1], length]) if (u > local + 1e-6 && u <= length) steps.push([u, gain(u)]);
  return steps;
}

/** The mix's level now, by channel (left, right): its latest samples, as the audio meters read them. */
export type MixSamples = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

/** How far film time `t` is from a sound: 0 while it plays, else until it starts; one already past after all those. */
function awayFrom(s: Sound, t: number) {
  const end = s.at + (s.to - s.from) / s.speed;
  return t < s.at ? s.at - t : t < end ? 0 : 1e6 + t - end;
}

export class Player {
  private ctx: AudioContext | null = null;
  /** each file's decoded sound, and the version of the file it was decoded from (undefined: not known then) */
  private buffers = new Map<string, { version: number | undefined; buffer: Promise<AudioBuffer | null> }>();
  private origin = '';
  private versionOf: (src: string) => number | undefined = () => undefined;
  private sounds: Sound[] = [];
  private playingNodes: AudioScheduledSourceNode[] = [];
  private startedAt = 0;
  private startT = 0;
  private pausedT = 0;
  /** playing without sound: the clock is performance.now(), in seconds, from `startedAt` */
  private silent = false;
  /** which call to play is the latest: an earlier one still waiting for the sound gives up */
  private starts = 0;
  private master: GainNode | null = null;
  /** every sound, before the person's volume: what the meters read */
  private mix: GainNode | null = null;
  private analysers: [AnalyserNode, AnalyserNode] | null = null;
  private samples: MixSamples | null = null;
  /** the clips heard (solo); null: all of them */
  private heard: ReadonlySet<string> | null = null;
  private fetching = 0;
  private queued: { src: string; go: () => void }[] = [];
  playing = false;
  duration = 0;
  /** the person's volume (0–1), muting and playback speed (the fullscreen bar's): the whole film's, not a clip's */
  volume = 1;
  muted = false;
  rate = 1;

  /** The film's sounds, fetched from `origin` (the film's origin) and decoded once each (once per version). */
  load(origin: string, sounds: Sound[], duration: number) {
    this.origin = origin;
    this.sounds = sounds;
    this.duration = duration;
    this.fetchSounds();
    if (this.playing) this.play(this.time());
  }

  /**
   * Which version of each file is on disk (its modified time). A sound made again under the same name (a voice-over
   * regenerated in place) is fetched again, and heard from where the film is; without this the old one played on.
   */
  setVersions(versionOf: (src: string) => number | undefined) {
    this.versionOf = versionOf;
    if (this.fetchSounds() && this.playing) this.play(this.time());
  }

  /** Fetches the sounds not decoded yet, or decoded from an older version; says whether there were any. */
  private fetchSounds(): boolean {
    if (!this.origin) return false;
    const ctx = this.context();
    let fetched = false;
    const t = this.time();
    for (const s of [...this.sounds].sort((a, b) => awayFrom(a, t) - awayFrom(b, t))) {
      const version = this.versionOf(s.src);
      const had = this.buffers.get(s.src);
      /* a version not known on one side is taken as the same: the file was not seen to change */
      if (had && (had.version === version || had.version === undefined || version === undefined)) {
        had.version ??= version;
        continue;
      }
      const url = new URL(s.src, this.origin);
      url.searchParams.set('film-sound', '1');
      /* past the browser's cache, which keeps the old file under the same address */
      if (version !== undefined) url.searchParams.set('v', String(version));
      this.buffers.set(s.src, { version, buffer: this.slot(s.src)
        .then((done) => fetch(url)
          /* 204: there is no sound in it */
          .then((r) => (r.status === 204 ? null : r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .finally(done))
        .then((bytes) => (bytes ? ctx.decodeAudioData(bytes) : null))
        .catch(() => null) });
      fetched = true;
    }
    return fetched;
  }

  /** A turn to fetch `src`'s sound; resolves with what ends it. */
  private slot(src: string): Promise<() => void> {
    return new Promise((resolve) => {
      const go = () => {
        this.fetching += 1;
        resolve(() => { this.fetching -= 1; this.next(); });
      };
      if (this.fetching < FETCHES) go();
      else this.queued.push({ src, go });
    });
  }

  /** The waiting fetch whose sound is nearest to where the film is (playing there or next), started. */
  private next() {
    if (!this.queued.length || this.fetching >= FETCHES) return;
    const t = this.time();
    const away = (src: string) => Math.min(...this.sounds.filter((s) => s.src === src).map((s) => awayFrom(s, t)));
    let best = 0;
    for (let i = 1; i < this.queued.length; i++) if (away(this.queued[i].src) < away(this.queued[best].src)) best = i;
    const [pick] = this.queued.splice(best, 1);
    pick.go();
  }

  private context() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.mix = this.ctx.createGain();
      this.mix.connect(this.master);
      /* a splitter takes two channels in: a mono mix is heard, and metered, on both */
      const split = this.ctx.createChannelSplitter(2);
      this.mix.connect(split);
      const meter = (channel: number) => {
        const a = this.ctx!.createAnalyser();
        a.fftSize = 2048;
        split.connect(a, channel);
        return a;
      };
      this.analysers = [meter(0), meter(1)];
      /* the sound was not allowed to start when play was pressed; now it is: it joins where the film is */
      const ctx = this.ctx;
      ctx.addEventListener('statechange', () => { if (ctx.state === 'running' && this.playing && this.silent) void this.play(this.time()); });
    }
    return this.ctx;
  }

  /**
   * The mix's latest samples (about 40 ms), left and right, or null when nothing is playing here (paused, no sound
   * yet): read by the meters once a frame while the film plays.
   */
  levels(): MixSamples | null {
    if (!this.analysers || !this.playing || this.silent) return null;
    const [l, r] = this.analysers;
    this.samples ??= [new Float32Array(l.fftSize), new Float32Array(r.fftSize)];
    l.getFloatTimeDomainData(this.samples[0]);
    r.getFloatTimeDomainData(this.samples[1]);
    return this.samples;
  }

  /** Only these clips are heard (the tracks soloed), or all (null); playing goes on from where it is. */
  setHeard(clips: ReadonlySet<string> | null) {
    const same = clips === this.heard || (clips && this.heard && clips.size === this.heard.size && [...clips].every((c) => this.heard!.has(c)));
    this.heard = clips;
    if (!same && this.playing) void this.play(this.time());
  }

  /** Try to start the sound again (a click or key on the page lets a browser that refused it before). */
  wake() {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.volume > 0) this.muted = false;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  /** Play faster or slower (pitch moves with it); playing goes on from where it is. */
  setRate(rate: number) {
    const t = this.time();
    this.rate = Math.max(0.25, Math.min(2, rate));
    if (this.playing) void this.play(t);
  }

  /** Where the film is, in seconds. */
  time(): number {
    if (!this.playing || !this.ctx) return this.pausedT;
    /* the sound starts a moment after play (see play): until then the picture waits where it starts */
    const now = this.silent ? performance.now() / 1000 : this.ctx.currentTime;
    const t = this.startT + Math.max(0, now - this.startedAt) * this.rate;
    return Math.min(t, this.duration);
  }

  /**
   * Play from `t`. Sounds not decoded yet join when they are. Playing starts at once, on the page's clock: the
   * sound starts when the browser lets it (resume() can take a while, or never come), and joins where the film is by
   * then. Anything that waits for `playing` sees it now, not after that wait.
   */
  async play(t = this.time()) {
    this.stopNodes();
    if (t >= this.duration - 1e-3) t = 0;
    const go = ++this.starts;
    this.playing = true;
    this.startT = t;
    this.silent = true;
    this.startedAt = performance.now() / 1000;
    const ctx = this.context();
    /* a resume the browser holds back never settles: wait a moment, then play on without the sound */
    await Promise.race([ctx.resume().catch(() => {}), new Promise((done) => setTimeout(done, RESUME_WAIT_MS))]);
    /* paused, sought or played again while waiting: that call decides */
    if (go !== this.starts || !this.playing) return;
    if (ctx.state !== 'running') return;
    this.startT = this.time();
    this.silent = false;
    this.startedAt = ctx.currentTime + 0.05;
    t = this.startT;
    const startedAt = this.startedAt;
    for (const s of this.sounds) {
      if (this.heard && !(s.clip && this.heard.has(s.clip))) continue;
      const length = (s.to - s.from) / s.speed;
      const end = s.at + length;
      if (end <= t) continue;
      void this.buffers.get(s.src)?.buffer.then((buffer) => {
        if (!buffer || !this.playing || this.startedAt !== startedAt) return;
        this.schedule(buffer, s, t, end);
      });
    }
  }

  /** One sound from film time `t` on: its offset into the file, its speed, its volume. */
  private schedule(buffer: AudioBuffer, s: Sound, t: number, end: number) {
    const ctx = this.context();
    const now = ctx.currentTime;
    /* where the film is when this sound is scheduled (decoding may have taken a moment since play) */
    const r = this.rate;
    const filmNow = Math.max(t, this.startT + (now - this.startedAt) * r);
    const startFilm = Math.max(s.at, filmNow);
    if (startFilm >= end) return;
    /* film seconds → context seconds: a film second lasts 1 / rate */
    const ctxAt = (filmT: number) => this.startedAt + (filmT - this.startT) / r;
    const when = ctxAt(startFilm);
    const offset = s.from + (startFilm - s.at) * s.speed;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = s.speed * r;
    const gain = ctx.createGain();
    if (s.fade) {
      /* its fades as ramps on the audio clock, sample-accurate: from where it starts, each corner at its own moment */
      const [[, first], ...rest] = fadeSteps(startFilm - s.at, end - s.at, s.fade);
      gain.gain.setValueAtTime(s.volume * first, Math.max(now, when));
      for (const [u, g] of rest) gain.gain.linearRampToValueAtTime(s.volume * g, Math.max(now, ctxAt(s.at + u)));
    } else gain.gain.value = s.volume;
    source.connect(gain).connect(this.mix ?? ctx.destination);
    source.start(Math.max(now, when), offset, (end - startFilm) * s.speed);
    this.playingNodes.push(source);
  }

  pause() {
    this.pausedT = this.time();
    this.playing = false;
    this.stopNodes();
  }

  /** Move to `t`; playing goes on from there. */
  seek(t: number) {
    const clamped = Math.max(0, Math.min(t, this.duration));
    if (this.playing) void this.play(clamped);
    else this.pausedT = clamped;
  }

  private stopNodes() {
    for (const node of this.playingNodes) { try { node.stop(); } catch { /* already stopped */ } }
    this.playingNodes = [];
  }

  close() {
    this.pause();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.mix = null;
    this.analysers = null;
  }
}
