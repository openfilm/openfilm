/**
 * The film's sound engine (src/sound-engine.mjs) on the preview's audio thread: an AudioWorklet module the player adds
 * to its audio context (player.ts). The code that processes the samples is the engine's, the export's own, so what
 * the preview hears of a mix is what the export delivers of it, sample for sample.
 *
 * - `openfilm-bus`: the film's mix through its bus (the delivery gain, then the limiter): what is heard and metered.
 *   Its sound comes out `limiterLatency` frames after it went in. Told `{ gainDb, frames }`: turned there over that
 *   many frames. Told `{ start, warm }`: from frame `start` on (the frame the film is heard from after a play or a
 *   seek) the bus is one started anew and fed `warm` first, the mix of the second before (its output not heard), so it
 *   is where an export of the whole film is at that frame.
 * - `openfilm-clip`: a clip's sound through its chain (clipChain), `processorOptions: { chain, warm }`; `warm` is the
 *   clip's own sound of the second before where it starts playing, when it starts inside the clip. Told 'end': done.
 */
import { Bus, clipChain, type Processor, type Step } from '../../../../src/sound-engine.mjs';

/* what the audio thread's scope has */
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor & { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }): void;

/** A mix and the bus's other messages. */
export type BusMessage = { gainDb: number; frames: number } | { start: number; warm: [Float32Array, Float32Array] | null };

/** A block's input, both channels: silence when nothing plays into it, the left one on both sides when mono. */
function sides(input: Float32Array[] | undefined, silence: Float32Array): [Float32Array, Float32Array] {
  const l = input?.[0] ?? silence;
  return [l, input?.[1] ?? l];
}

/** A block of `n` frames thrown away: what a warm-up's output goes into. */
const away = (n: number) => new Float32Array(n);

class BusProcessor extends AudioWorkletProcessor {
  private bus: Bus;
  /** the bus started anew and warmed, taken at frame `start` */
  private next: { bus: Bus; start: number } | null = null;
  private gainDb: number;
  private silence = new Float32Array(128);
  private right = new Float32Array(128);

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.gainDb = Number((options.processorOptions as { gainDb?: number } | undefined)?.gainDb) || 0;
    this.bus = new Bus({ gainDb: this.gainDb, rate: sampleRate });
    this.port.onmessage = (e: MessageEvent<BusMessage>) => this.told(e.data);
  }

  told(m: BusMessage) {
    if ('gainDb' in m) {
      this.gainDb = m.gainDb;
      this.bus.setGain(m.gainDb, m.frames);
      this.next?.bus.setGain(m.gainDb);
      return;
    }
    const bus = new Bus({ gainDb: this.gainDb, rate: sampleRate });
    if (m.warm) {
      const [l, r] = m.warm;
      bus.process(l, r, away(l.length), away(l.length));
    }
    this.next = { bus, start: m.start };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    const n = out[0].length;
    if (this.silence.length < n) { this.silence = new Float32Array(n); this.right = new Float32Array(n); }
    const [l, r] = sides(inputs[0], this.silence.subarray(0, n));
    const outL = out[0], outR = out[1] ?? this.right.subarray(0, n);
    const next = this.next;
    /* the bus started anew from its frame on: this block's frames before it go through the one there was */
    if (next && next.start < currentFrame + n) {
      const k = Math.max(0, Math.min(n, next.start - currentFrame));
      if (k) this.bus.process(l.subarray(0, k), r.subarray(0, k), outL.subarray(0, k), outR.subarray(0, k));
      this.bus = next.bus;
      this.next = null;
      this.bus.process(l.subarray(k), r.subarray(k), outL.subarray(k), outR.subarray(k));
    } else this.bus.process(l, r, outL, outR);
    return true;
  }
}

class ClipProcessor extends AudioWorkletProcessor {
  private chain: Processor | null;
  private ended = false;
  private silence = new Float32Array(128);
  private right = new Float32Array(128);

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { chain, warm } = (options.processorOptions ?? {}) as { chain?: Step[]; warm?: [Float32Array, Float32Array] | null };
    this.chain = clipChain(chain, sampleRate);
    if (warm && this.chain) this.chain.process(warm[0], warm[1], away(warm[0].length), away(warm[0].length));
    this.port.onmessage = () => { this.ended = true; };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    if (this.ended) return false;
    const out = outputs[0];
    const n = out[0].length;
    if (this.silence.length < n) { this.silence = new Float32Array(n); this.right = new Float32Array(n); }
    const [l, r] = sides(inputs[0], this.silence.subarray(0, n));
    const outL = out[0], outR = out[1] ?? this.right.subarray(0, n);
    if (this.chain) this.chain.process(l, r, outL, outR);
    else { outL.set(l); outR.set(r); }
    return true;
  }
}

registerProcessor('openfilm-bus', BusProcessor);
registerProcessor('openfilm-clip', ClipProcessor);
