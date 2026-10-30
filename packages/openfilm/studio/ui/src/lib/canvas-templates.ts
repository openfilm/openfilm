/**
 * Canvas templates: parts of a board kept to be laid down again (studio/server/canvas-templates.mjs keeps the person's
 * own), and the ones OpenFilm comes with, ways of working to start from. A template's board starts at 0, 0; laid down,
 * every node is new (copyOf).
 */
import { MAKE_W, NOTE_W, type CanvasDoc } from './canvas.ts';

export interface CanvasTemplate { id: string; name: string; nodes: number; builtIn?: boolean }

/** where a group's nodes start in it, and the room between them */
const PAD = 32;
const HEAD = 52;
const GAP = 60;
/** a making node's height, as it is drawn at MAKE_W wide (a 16:9 picture over its words and options) */
const MAKE_H = 440;

/**
 * The templates OpenFilm comes with, in the person's words (`say`: a canvas.templates string):
 *   · picture to clip: a shot's idea → its picture → the clip made from it
 *   · storyboard: three shots, a row each: an idea and its picture
 */
export function builtInTemplates(say: (key: string) => string): Array<CanvasTemplate & { doc: CanvasDoc }> {
  const clip: CanvasDoc = {
    nodes: [
      { id: 'g', x: 0, y: 0, w: PAD + NOTE_W + GAP + MAKE_W + GAP + MAKE_W + PAD, h: HEAD + MAKE_H + PAD, group: say('clip'), color: 'purple' },
      { id: 'idea', x: PAD, y: HEAD, w: NOTE_W, h: 140, text: say('clipIdea'), parent: 'g' },
      { id: 'still', x: PAD + NOTE_W + GAP, y: HEAD, w: MAKE_W, make: 'image', prompt: '', opts: { ratio: '16:9' }, parent: 'g' },
      { id: 'move', x: PAD + NOTE_W + GAP + MAKE_W + GAP, y: HEAD, w: MAKE_W, make: 'video', prompt: say('clipMove'), opts: { ratio: '16:9' }, parent: 'g' },
    ],
    edges: [{ id: 'e1', from: 'idea', to: 'still', order: 0 }, { id: 'e2', from: 'still', to: 'move', order: 0 }],
  };
  /* a row a shot: its idea, then its picture, so the wires run left to right */
  const row = MAKE_H + GAP;
  const shots = [0, 1, 2];
  const storyboard: CanvasDoc = {
    nodes: [
      { id: 'g', x: 0, y: 0, w: PAD + NOTE_W + GAP + MAKE_W + PAD, h: HEAD + shots.length * row - GAP + PAD, group: say('storyboard'), color: 'blue' },
      ...shots.flatMap((i) => [
        { id: `beat${i}`, x: PAD, y: HEAD + i * row, w: NOTE_W, h: 140, text: say('storyboardShot').replace('{n}', String(i + 1)), parent: 'g' },
        { id: `frame${i}`, x: PAD + NOTE_W + GAP, y: HEAD + i * row, w: MAKE_W, make: 'image' as const, prompt: '', opts: { ratio: '16:9' }, parent: 'g' },
      ]),
    ],
    edges: shots.map((i) => ({ id: `e${i}`, from: `beat${i}`, to: `frame${i}`, order: 0 })),
  };
  return [
    { id: 'builtin:clip', name: say('clip'), nodes: clip.nodes.length, builtIn: true, doc: clip },
    { id: 'builtin:storyboard', name: say('storyboard'), nodes: storyboard.nodes.length, builtIn: true, doc: storyboard },
  ];
}
