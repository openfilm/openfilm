/**
 * Sound recorded from the computer's microphone (the timeline's record button, components/RecordButton): taken with
 * MediaRecorder, then written as a WAV file, a file every player and every export reads, named for when it was made.
 * Where the page cannot read back what it recorded, the recording is kept as the browser made it.
 */

/** Why recording could not start: the microphone refused, none there, or anything else. */
export type RecordProblem = 'denied' | 'missing' | 'failed';

/** A recording under way: how loud it is now (peak, 0…1), and its end, kept or not. */
export interface Recording {
  /** When it started (performance.now()). */
  startedAt: number;
  /** The loudest sample of the latest moment, 0…1. */
  level(): number;
  /** Stop, and the sound as a file named for `name` (without its ending). */
  stop(name: string): Promise<File>;
  /** Stop and keep nothing. */
  cancel(): void;
}

/** A recording's file name, without its ending: `Recording 2026-11-03 14.20.05` (no `:` — Windows forbids it). */
export function recordingName(word: string, at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${word} ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}`;
}

/** What a failure to open the microphone means for the person (getUserMedia's error names). */
export function recordProblemOf(e: unknown): RecordProblem {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError' || name === 'NotReadableError') return 'missing';
  return 'failed';
}

/** The channels mixed down to one, written as 16-bit PCM WAV. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer {
  const frames = channels[0]?.length ?? 0;
  const out = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(out);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (const c of channels) sum += c[i]!;
    const v = Math.max(-1, Math.min(1, sum / channels.length));
    view.setInt16(44 + i * 2, v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), true);
  }
  return out;
}

/** The ending a recording kept as the browser made it gets, from its type. */
export function endingOf(type: string): string {
  if (/mp4|aac/.test(type)) return '.m4a';
  if (/ogg/.test(type)) return '.ogg';
  return '.weba';
}

/** Open the microphone and start recording; throws a RecordProblem when it cannot. */
export async function startRecording(): Promise<Recording> {
  let stream: MediaStream;
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw Object.assign(new Error('no recording'), { name: 'NotSupportedError' });
    /* no echo cancellation: it is for calls, and thins a voice recorded for a film */
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } });
  } catch (e) {
    throw recordProblemOf(e);
  }
  const close = () => { for (const track of stream.getTracks()) track.stop(); };
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
  recorder.start(250);
  const end = () => { close(); void context.close().catch(() => {}); };
  return {
    startedAt: performance.now(),
    level() {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const v of samples) if (Math.abs(v) > peak) peak = Math.abs(v);
      return Math.min(1, peak);
    },
    async stop(name) {
      const stopped = new Promise<void>((done) => recorder.addEventListener('stop', () => done(), { once: true }));
      recorder.stop();
      await stopped;
      end();
      const made = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || '' });
      try {
        const decoder = new OfflineAudioContext(1, 1, 48000);
        const sound = await decoder.decodeAudioData(await made.arrayBuffer());
        const channels = Array.from({ length: sound.numberOfChannels }, (_, i) => sound.getChannelData(i));
        return new File([encodeWav(channels, sound.sampleRate)], `${name}.wav`, { type: 'audio/wav' });
      } catch {
        return new File([made], `${name}${endingOf(made.type)}`, { type: made.type });
      }
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop();
      end();
    },
  };
}
