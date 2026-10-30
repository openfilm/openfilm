/**
 * The film's sound, played with Web Audio, and the clock the picture follows. The picture is drawn in the preview
 * (another origin, see Preview), which runs its own frames from this clock's anchor (`anchor`, told on each change
 * through `onAnchor`): a straight line from a film second at a moment of the page's clock, at the playing rate. While
 * the sound plays, that line is where the sound is heard: the audio context says when the sample it plays now reaches
 * the ears (its output timestamp, the device's latency included), and the line follows it, eased so the picture never
 * jumps. A browser that will not start the sound yet (no click on the page so far, an embedding app's stricter rules)
 * does not stop the film: the line is then the page's clock alone, the picture plays silent, and the sound joins where
 * the film is as soon as the browser lets it start.
 *
 * `sounds` is the timeline's own list (src/timeline.mjs `__filmSounds`): each sound clip's sound and each video's own,
 * already placed and cut to its clip, with its volume and speed. Each file's sound is fetched small (`?film-sound`, see
 * studio/server/pages.mjs): a video's is a copy of its sound alone, never the whole video. A sound heard at its own
 * speed (its clip's speed by the viewer's is 1) is decoded and played sample-accurate. One heard faster or slower is
 * played by the browser's own media element with its pitch kept (`preservesPitch`), in the same mix: another speed is
 * heard at once, with nothing made for it, and its place is checked against the film as it plays. One whose rate is
 * beyond what a browser plays (faster than 16×, slower than 1/16×) is not heard: its picture goes on alone, by its
 * frames (src/timeline.mjs), and the export mixes it from the file. A sound not here yet
 * (its copy still being made) is silent until it is, then joins where the film is. Sounds are started a few seconds
 * ahead of the film, not all at once: a film of hundreds of sounds starts as quickly as one of a few.
 *
 * Every sound goes through one mix, metered (`levels`: the audio meters read it while the film plays, nothing reads it
 * paused) before the person's volume. Solo (`setHeard`) leaves the clips of the other tracks out of what plays here
 * only: the film and its exports are as they are.
 */

import { SPEED_MAX, SPEED_MIN } from '../lib/playback-speed.ts';
import { MEDIA_RATE_MAX, MEDIA_RATE_MIN, mediaPlays } from '../../../../src/film-doc.mjs';

/** Sounds fetched at once; the others wait, the ones nearest to where the film is first. */
const FETCHES = 3;
/** How far ahead of the film sounds are started (film seconds); the rest are started as the film gets near them. */
const AHEAD = 8;
/** How often, while playing, sounds coming up are started and the line is checked against the sound (ms). */
const CHECK_MS = 250;
/** How long after now a sound can be started at the soonest (s): sooner, its start is cut. */
const LEAD = 0.03;
/** A sound played by a media element further than this from where the film is (s) is put back in its place. */
const DRIFT = 0.12;
/** After a sound is put back in its place, how long it is left to settle before it is checked again (ms). */
const SETTLE_MS = 1000;

/** `fade`: its fades in and out, film seconds, already fitted to its length (src/timeline.mjs). */
export type Sound = { src: string; at: number; from: number; to: number; volume: number; speed: number; clip?: string; fade?: [number, number] };

/**
 * Where the film is while it plays: film second `t` at `at` (ms on the page's clock, performance.now()), moving on
 * `rate` film seconds a second.
 */
export type Anchor = { t: number; at: number; rate: number };

/** The film second an anchor puts at `now` (ms on the page's clock): `t` until its moment comes, then on from there. */
export function anchorTime(a: Anchor, now: number): number {
  return a.t + (Math.max(0, now - a.at) / 1000) * a.rate;
}

/** A change of the sound's lead over the page's clock eased in at most this much per check (s): 0.2% of a second. */
export const EASE_STEP = 0.0005;
/** A change larger than this is taken at once (s): another output device, a stall of the sound. */
export const JUMP = 0.05;

/**
 * How far the audio clock is ahead of the page's (s), as last taken (`current`, null before the first), moved toward
 * what the output timestamp says now (`measured`): eased by EASE_STEP a check so the picture following it never jumps,
 * at once when it is far off or nothing was taken yet.
 */
export function easedLead(current: number | null, measured: number): number {
  if (current == null || Math.abs(measured - current) > JUMP) return measured;
  return current + Math.max(-EASE_STEP, Math.min(EASE_STEP, measured - current));
}

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

/** A sound's length on the film (s). */
const lengthOf = (s: Sound) => (s.to - s.from) / s.speed;

/**
 * The rate a sound's media element plays its file at, its pitch kept: its clip's speed by the viewer's, within what a
 * browser plays (MEDIA_RATE_MIN to _MAX; a sound beyond them is not heard, see startDue). Null when that is 1: the
 * sound is decoded and played as it is.
 */
export function stretchRate(speed: number, rate: number): number | null {
  const v = Math.round(speed * rate * 1e4) / 1e4;
  return v === 1 ? null : Math.max(MEDIA_RATE_MIN, Math.min(MEDIA_RATE_MAX, v));
}

/** Where in its file a sound is at film second `t` (s). */
export function fileTime(s: Sound, t: number): number {
  return s.from + (t - s.at) * s.speed;
}

/**
 * A sound played by a media element: the element, what it goes through in the mix, when it was last put back, and
 * what starts it once its file is ready (`ready`, listened for until then).
 */
type Voice = { el: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode; sound: Sound; timer: number; settled: number; ready?: () => void };

/**
 * Where a sound joins the film when its file is ready only now (its copy was still being made, the file slow to read):
 * the film second the mix plays at audio-clock time `ctxNow`, not where it was when loading began; null when the
 * sound has ended by then.
 */
export function joinAt(s: Sound, heard: { t: number; at: number }, ctxNow: number, rate: number, from: number): number | null {
  const now = Math.max(from, heard.t + (ctxNow - heard.at) * rate);
  return now >= s.at + lengthOf(s) ? null : now;
}

/** How far film time `t` is from a sound: 0 while it plays, else until it starts; one already past after all those. */
function awayFrom(s: Sound, t: number) {
  const end = s.at + lengthOf(s);
  return t < s.at ? s.at - t : t < end ? 0 : 1e6 + t - end;
}

/**
 * The sounds to start now, by their place in `sounds`: those heard between film seconds `from` and `until` (a sound
 * playing at `from` included), not started already (`started`) and not left out (`heard`: the clips heard, null all).
 */
export function soundsDue(sounds: readonly Sound[], from: number, until: number, started: ReadonlySet<number>, heard: ReadonlySet<string> | null): number[] {
  const due: number[] = [];
  sounds.forEach((s, i) => {
    if (started.has(i) || (heard && !(s.clip && heard.has(s.clip)))) return;
    if (s.at + lengthOf(s) > from && s.at < until) due.push(i);
  });
  return due;
}

export class Player {
  private ctx: AudioContext | null = null;
  /** each file's decoded sound, and the version of the file it was decoded from (undefined: not known then) */
  private buffers = new Map<string, { version: number | undefined; buffer: Promise<AudioBuffer | null> }>();
  private origin = '';
  private versionOf: (src: string) => number | undefined = () => undefined;
  private sounds: Sound[] = [];
  private playingNodes: AudioScheduledSourceNode[] = [];
  /** the sounds heard faster or slower, each played by a media element (see stretchRate) */
  private voices: Voice[] = [];
  /** where the film is while playing, on the page's clock (see Anchor) */
  private line: Anchor = { t: 0, at: 0, rate: 1 };
  /** the same line on the audio clock while the sound plays: film second `t` is heard at audio time `at` (s); null silent */
  private heardLine: { t: number; at: number } | null = null;
  /** how far the audio clock is ahead of the page's (s), eased (see easedLead); null until taken */
  private lead: number | null = null;
  private pausedT = 0;
  /** the sounds started this time the film plays, by their place in `sounds` */
  private started = new Set<number>();
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
  private checks = 0;
  playing = false;
  duration = 0;
  /** the person's volume (0–1), muting and playback speed (the fullscreen bar's): the whole film's, not a clip's */
  volume = 1;
  muted = false;
  rate = 1;
  /** Told each time the line the film plays on changes (a play, a seek, another speed, the sound joining or moving). */
  onAnchor: ((a: Anchor) => void) | null = null;

  /** The film's sounds, fetched from `origin` (the film's origin) and decoded once each (once per version). */
  load(origin: string, sounds: Sound[], duration: number) {
    this.origin = origin;
    this.sounds = sounds;
    this.duration = duration;
    this.fetchSounds();
    if (this.playing) this.restart();
  }

  /**
   * Which version of each file is on disk (its modified time). A sound made again under the same name (a voice-over
   * regenerated in place) is fetched again, and heard from where the film is; without this the old one played on.
   */
  setVersions(versionOf: (src: string) => number | undefined) {
    this.versionOf = versionOf;
    if (this.fetchSounds() && this.playing) this.restart();
  }

  /**
   * Fetches the sounds not decoded yet, or decoded from an older version; says whether there were any. A clip at another
   * speed is never decoded: a media element plays it.
   */
  private fetchSounds(): boolean {
    if (!this.origin) return false;
    const ctx = this.context();
    let fetched = false;
    const t = this.time();
    for (const s of [...this.sounds].filter((x) => x.speed === 1).sort((a, b) => awayFrom(a, t) - awayFrom(b, t))) {
      const version = this.versionOf(s.src);
      const had = this.buffers.get(s.src);
      /* a version not known on one side is taken as the same: the file was not seen to change */
      if (had && (had.version === version || had.version === undefined || version === undefined)) {
        had.version ??= version;
        continue;
      }
      const url = this.soundUrl(s.src);
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

  /** The address of a file's sound, small (`?film-sound`), past the browser's cache when the file was made again. */
  private soundUrl(src: string): string {
    const url = new URL(src, this.origin);
    url.searchParams.set('film-sound', '1');
    const version = this.versionOf(src);
    if (version !== undefined) url.searchParams.set('v', String(version));
    return url.href;
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
      ctx.addEventListener('statechange', () => { if (ctx.state === 'running' && this.playing && !this.heardLine) this.join(); });
    }
    return this.ctx;
  }

  /**
   * How far the audio clock is ahead of the page's now (s): the output timestamp pairs the audio time being heard with
   * the page time it is heard at. Before the device has said (its first moments), the context's own time less its
   * latencies. Null while the sound is not running.
   */
  private measuredLead(): number | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (stamp && Number(stamp.contextTime) > 0 && Number(stamp.performanceTime) > 0) return stamp.contextTime! - stamp.performanceTime! / 1000;
    return ctx.currentTime - (ctx.baseLatency || 0) - (ctx.outputLatency || 0) - performance.now() / 1000;
  }

  /**
   * The mix's latest samples (about 40 ms), left and right, or null when nothing is playing here (paused, no sound
   * yet): read by the meters once a frame while the film plays.
   */
  levels(): MixSamples | null {
    if (!this.analysers || !this.playing || !this.heardLine) return null;
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
    if (!same && this.playing) this.restart();
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

  /** Play faster or slower, the pitch kept (see stretchRate); playing goes on from where it is, heard at once. */
  setRate(rate: number) {
    const t = this.time();
    const next = Math.max(SPEED_MIN, Math.min(SPEED_MAX, rate));
    if (next === this.rate) return;
    this.rate = next;
    if (this.playing) this.restart(t);
  }

  /** Where the film is, in seconds. */
  time(): number {
    if (!this.playing) return this.pausedT;
    return Math.max(0, Math.min(anchorTime(this.line, performance.now()), this.duration));
  }

  /** The line the film plays on now, or null while paused. */
  anchor(): Anchor | null {
    return this.playing ? { ...this.line } : null;
  }

  /**
   * Play from `t`. The picture starts with the sound: with the sound running already, both start a moment from now
   * (as long as starting a sound takes, and the device's latency), from `t`. A browser holding the sound back does
   * not hold the film: it plays on the page's clock at once, and the sound joins where it is when it may.
   */
  play(t = this.time()) {
    this.stopNodes();
    if (t >= this.duration - 1e-3) t = 0;
    const go = ++this.starts;
    this.playing = true;
    const ctx = this.context();
    const lead = ctx.state === 'running' ? this.measuredLead() : null;
    if (lead != null) {
      this.lead = easedLead(null, lead);
      /* heard from t at audio time `at`: the picture is at t when that is heard */
      const at = ctx.currentTime + LEAD;
      this.heardLine = { t, at };
      this.line = { t, at: (at - this.lead) * 1000, rate: this.rate };
      this.startDue();
    } else {
      this.heardLine = null;
      this.line = { t, at: performance.now(), rate: this.rate };
      void ctx.resume().catch(() => {}).then(() => { if (go === this.starts && this.playing && !this.heardLine && ctx.state === 'running') this.join(); });
    }
    this.watch();
    this.onAnchor?.(this.anchor()!);
  }

  /**
   * Playing on from where the film is, its sounds started again (another speed, a solo, the sounds changed): the
   * picture goes on without a jump, the sounds join a moment later.
   */
  private restart(t = this.time()) {
    this.stopNodes();
    this.line = { t, at: performance.now(), rate: this.rate };
    this.heardLine = null;
    if (this.ctx?.state === 'running') this.join();
    this.onAnchor?.(this.anchor()!);
  }

  /** The sound joins the film where it is (it was not running, or it is started again): the picture keeps its line. */
  private join() {
    const lead = this.measuredLead();
    if (lead == null || !this.playing) return;
    this.lead = easedLead(null, lead);
    /* where the line puts the film when a sound started now is heard */
    const at = this.ctx!.currentTime + LEAD;
    this.heardLine = { t: anchorTime(this.line, (at - this.lead) * 1000), at };
    this.started.clear();
    this.startDue();
  }

  /** While playing: start the sounds coming up, and keep the picture's line on the sound as it is heard. */
  private watch() {
    window.clearInterval(this.checks);
    this.checks = window.setInterval(() => {
      if (!this.playing) { window.clearInterval(this.checks); return; }
      if (!this.heardLine) return;
      const measured = this.measuredLead();
      if (measured != null) {
        const lead = easedLead(this.lead, measured);
        if (lead !== this.lead) {
          this.lead = lead;
          /* the picture follows the sound as heard: the same line, on the page's clock by the lead now */
          this.line = { t: this.heardLine.t, at: (this.heardLine.at - lead) * 1000, rate: this.rate };
          this.onAnchor?.(this.anchor()!);
        }
      }
      this.startDue();
      this.keepVoices();
    }, CHECK_MS);
  }

  /** Start the sounds heard from now to AHEAD seconds on that are not started yet. */
  private startDue() {
    const heard = this.heardLine;
    if (!heard || !this.ctx) return;
    const now = anchorTime({ t: heard.t, at: heard.at * 1000, rate: this.rate }, (this.ctx.currentTime + LEAD) * 1000);
    for (const i of soundsDue(this.sounds, now, now + AHEAD * this.rate, this.started, this.heard)) {
      this.started.add(i);
      const s = this.sounds[i];
      /* its clip's speed by the viewer's beyond what a browser plays (MEDIA_RATE_MIN to _MAX): not heard here, the
         picture alone goes on (by its frames); an export mixes it from its file */
      if (!mediaPlays(s.speed * this.rate)) continue;
      if (stretchRate(s.speed, this.rate) != null) { this.voice(s, heard); continue; }
      void this.buffers.get(s.src)?.buffer.then((buffer) => {
        if (!buffer || !this.playing || this.heardLine !== heard) return;
        this.schedule(buffer, s, heard);
      });
    }
  }

  /** One sound, heard where `heard` puts it: from its start, or from where the film is when it starts late. */
  private schedule(buffer: AudioBuffer, s: Sound, heard: { t: number; at: number }) {
    const ctx = this.context();
    const r = this.rate;
    /* film seconds → audio seconds: a film second lasts 1 / rate */
    const ctxAt = (filmT: number) => heard.at + (filmT - heard.t) / r;
    const end = s.at + lengthOf(s);
    /* a sound whose start has passed (decoding took a moment, or the film started inside it) starts where the film is */
    const soonest = ctx.currentTime + LEAD;
    const startFilm = Math.max(s.at, heard.t + Math.max(0, soonest - heard.at) * r);
    if (startFilm >= end) return;
    const when = Math.max(soonest, ctxAt(startFilm));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.fades(s, startFilm, when, ctxAt);
    source.connect(gain).connect(this.mix ?? ctx.destination);
    source.start(when, fileTime(s, startFilm), end - startFilm);
    source.onended = () => {
      const i = this.playingNodes.indexOf(source);
      if (i >= 0) this.playingNodes.splice(i, 1);
    };
    this.playingNodes.push(source);
  }

  /** A sound's gain in the mix, its fades as ramps on the audio clock from `when` (film second `startFilm`) on. */
  private fades(s: Sound, startFilm: number, when: number, ctxAt: (filmT: number) => number): GainNode {
    const gain = this.context().createGain();
    if (s.fade) {
      /* sample-accurate: from where it starts, each corner at its own moment */
      const [[, first], ...rest] = fadeSteps(startFilm - s.at, lengthOf(s), s.fade);
      gain.gain.setValueAtTime(s.volume * first, when);
      for (const [u, g] of rest) gain.gain.linearRampToValueAtTime(s.volume * g, Math.max(when, ctxAt(s.at + u)));
    } else gain.gain.value = s.volume;
    return gain;
  }

  /**
   * One sound heard faster or slower: its file played by a media element at its rate, the pitch kept, through the mix.
   * It is put where the film will be when it starts and started then; keepVoices keeps it there.
   */
  private voice(s: Sound, heard: { t: number; at: number }) {
    const ctx = this.context();
    const r = this.rate;
    const ctxAt = (filmT: number) => heard.at + (filmT - heard.t) / r;
    const end = s.at + lengthOf(s);
    const soonest = ctx.currentTime + LEAD;
    const startFilm = Math.max(s.at, heard.t + Math.max(0, soonest - heard.at) * r);
    if (startFilm >= end) return;
    const when = Math.max(soonest, ctxAt(startFilm));
    const el = new Audio();
    /* the film's origin is not the editor's: read across, so the mix hears it (its server says the editor may) */
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.preservesPitch = true;
    el.src = this.soundUrl(s.src);
    el.defaultPlaybackRate = el.playbackRate = stretchRate(s.speed, r) ?? 1;
    el.currentTime = fileTime(s, startFilm);
    const source = ctx.createMediaElementSource(el);
    const gain = this.fades(s, startFilm, when, ctxAt);
    source.connect(gain).connect(this.mix ?? ctx.destination);
    const voice: Voice = { el, source, gain, sound: s, settled: 0, timer: 0 };
    /* started once its file is ready, where the film is then (a file not ready in time joins late, in step). Ready
       now, or on whichever of its events comes first; never twice; let go of with the voice (dropVoice) */
    const start = () => {
      if (!this.voices.includes(voice) || voice.ready !== start) return;
      el.removeEventListener('loadeddata', start);
      el.removeEventListener('canplay', start);
      voice.ready = undefined;
      const now = joinAt(s, heard, ctx.currentTime, r, startFilm);
      if (now == null) { this.dropVoice(voice); return; }
      if (Math.abs(el.currentTime - fileTime(s, now)) > DRIFT) el.currentTime = fileTime(s, now);
      el.playbackRate = stretchRate(s.speed, this.rate) ?? 1;
      void el.play().catch(() => {});
    };
    voice.timer = window.setTimeout(() => {
      if (!this.voices.includes(voice)) return;
      voice.ready = start;
      if (el.readyState >= 2) { start(); return; }
      el.addEventListener('loadeddata', start);
      el.addEventListener('canplay', start);
    }, Math.max(0, (when - ctx.currentTime) * 1000));
    this.voices.push(voice);
  }

  /** Each sound a media element plays, kept where the film is: put back when it drifts, let go when it has ended. */
  private keepVoices() {
    const heard = this.heardLine;
    const ctx = this.ctx;
    if (!heard || !ctx) return;
    /* the film second the mix plays now */
    const film = heard.t + (ctx.currentTime - heard.at) * this.rate;
    const now = performance.now();
    for (const v of [...this.voices]) {
      const s = v.sound;
      if (film >= s.at + lengthOf(s)) { this.dropVoice(v); continue; }
      if (film < s.at || v.el.paused || v.el.seeking || v.el.readyState < 2 || now - v.settled < SETTLE_MS) continue;
      const want = fileTime(s, film);
      if (Math.abs(v.el.currentTime - want) > DRIFT) { v.el.currentTime = want; v.settled = now; }
    }
  }

  private dropVoice(v: Voice) {
    window.clearTimeout(v.timer);
    if (v.ready) {
      v.el.removeEventListener('loadeddata', v.ready);
      v.el.removeEventListener('canplay', v.ready);
      v.ready = undefined;
    }
    v.el.pause();
    v.el.removeAttribute('src');
    v.el.load();
    try { v.source.disconnect(); v.gain.disconnect(); } catch { /* already apart */ }
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  pause() {
    this.pausedT = this.time();
    this.playing = false;
    this.starts += 1;
    window.clearInterval(this.checks);
    this.heardLine = null;
    this.stopNodes();
  }

  /** Move to `t`; playing goes on from there. */
  seek(t: number) {
    const clamped = Math.max(0, Math.min(t, this.duration));
    if (this.playing) this.play(clamped);
    else this.pausedT = clamped;
  }

  private stopNodes() {
    for (const node of this.playingNodes) { try { node.onended = null; node.stop(); } catch { /* already stopped */ } }
    this.playingNodes = [];
    for (const v of [...this.voices]) this.dropVoice(v);
    this.started.clear();
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
