/**
 * Canvas templates: parts of a board kept to be laid down again (studio/server/canvas-templates.mjs keeps the person's
 * own), and the ones OpenFilm comes with, ways of working to start from. A template's board starts at 0, 0; laid down,
 * every node is new (copyOf).
 */
import { CARD_H, CUT_W, MAKE_W, NOTE_W, cardWidth, type CanvasDoc } from './canvas.ts';

/** `about`: what laying it down gets, in a line; `flow`: what it is made of, in order, as its card draws it (OpenFilm's own) */
export interface CanvasTemplate { id: string; name: string; nodes: number; builtIn?: boolean; about?: string; flow?: Array<'note' | 'image' | 'video' | 'cut'> }

/** where a group's nodes start in it, and the room between them */
const PAD = 32;
const HEAD = 52;
const GAP = 60;
/** every card's height: a 16:9 one is MAKE_W wide */
const MAKE_H = CARD_H;

/**
 * The templates OpenFilm comes with, in the person's words (`say`: a canvas.templates string), each a way of working
 * whose words are left for the person to write (each note says what, from what it feeds):
 *   · picture to clip: a shot's idea → its picture → the clip made from it
 *   · character: who they are → their portrait → their front, side and back from it, to keep them the same in every shot
 *   · storyboard: three shots, a row each: an idea and its picture
 *   · episode: a character, then three shots each made with them (a picture, then its clip), cut together onto the timeline
 */
export function builtInTemplates(say: (key: string) => string): Array<CanvasTemplate & { doc: CanvasDoc }> {
  const clip: CanvasDoc = {
    nodes: [
      { id: 'g', x: 0, y: 0, w: PAD + NOTE_W + GAP + MAKE_W + GAP + MAKE_W + PAD, h: HEAD + MAKE_H + PAD, group: say('clip'), color: 'gray' },
      { id: 'idea', x: PAD, y: HEAD, w: NOTE_W, h: MAKE_H, text: '', parent: 'g' },
      { id: 'still', x: PAD + NOTE_W + GAP, y: HEAD, w: MAKE_W, h: MAKE_H, make: 'image', prompt: '', opts: { ratio: '16:9' }, parent: 'g' },
      { id: 'move', x: PAD + NOTE_W + GAP + MAKE_W + GAP, y: HEAD, w: MAKE_W, h: MAKE_H, make: 'video', prompt: '', opts: { ratio: '16:9' }, parent: 'g' },
    ],
    edges: [{ id: 'e1', from: 'idea', to: 'still', order: 0 }, { id: 'e2', from: 'still', to: 'move', order: 0 }],
  };
  /* a row a shot: its idea, then its picture, so the wires run left to right */
  const row = MAKE_H + GAP;
  const shots = [0, 1, 2];
  const storyboard: CanvasDoc = {
    nodes: [
      { id: 'g', x: 0, y: 0, w: PAD + NOTE_W + GAP + MAKE_W + PAD, h: HEAD + shots.length * row - GAP + PAD, group: say('storyboard'), color: 'gray' },
      ...shots.flatMap((i) => [
        { id: `beat${i}`, x: PAD, y: HEAD + i * row, w: NOTE_W, h: MAKE_H, text: '', parent: 'g' },
        { id: `frame${i}`, x: PAD + NOTE_W + GAP, y: HEAD + i * row, w: MAKE_W, h: MAKE_H, make: 'image' as const, prompt: '', opts: { ratio: '16:9' }, parent: 'g' },
      ]),
    ],
    edges: shots.map((i) => ({ id: `e${i}`, from: `beat${i}`, to: `frame${i}`, order: 0 })),
  };
  /* a portrait is narrower than a shot, as high */
  const PORTRAIT_W = cardWidth('3:4');
  /* who they are, their portrait, and their turnaround made from it */
  const character: CanvasDoc = {
    nodes: [
      { id: 'g', x: 0, y: 0, w: PAD + NOTE_W + GAP + PORTRAIT_W + GAP + MAKE_W + PAD, h: HEAD + MAKE_H + PAD, group: say('character'), color: 'gray' },
      { id: 'who', x: PAD, y: HEAD, w: NOTE_W, h: MAKE_H, text: '', parent: 'g' },
      { id: 'look', x: PAD + NOTE_W + GAP, y: HEAD, w: PORTRAIT_W, h: MAKE_H, make: 'image', prompt: say('portraitPrompt'), opts: { ratio: '3:4' }, parent: 'g' },
      { id: 'turn', x: PAD + NOTE_W + GAP + PORTRAIT_W + GAP, y: HEAD, w: MAKE_W, h: MAKE_H, make: 'image', prompt: say('turnaroundPrompt'), opts: { ratio: '16:9' }, parent: 'g' },
    ],
    edges: [{ id: 'e1', from: 'who', to: 'look', order: 0 }, { id: 'e2', from: 'look', to: 'turn', order: 0 }],
  };
  /*
   * the character on the first row (who, then their portrait), and under the portrait a row a shot: its idea, its
   * picture (made with the portrait), its clip; the three clips cut together at the end. Every wire runs rightwards.
   */
  const col = (i: number) => PAD + NOTE_W + GAP + i * (MAKE_W + GAP);
  const top = HEAD + MAKE_H + GAP;
  const episode: CanvasDoc = {
    nodes: [
      { id: 'g', x: 0, y: 0, w: col(3) + CUT_W + PAD, h: top + shots.length * row - GAP + PAD, group: say('episode'), color: 'gray' },
      { id: 'who', x: PAD, y: HEAD, w: NOTE_W, h: MAKE_H, text: '', parent: 'g' },
      { id: 'look', x: col(0), y: HEAD, w: PORTRAIT_W, h: MAKE_H, make: 'image', prompt: say('portraitPrompt'), opts: { ratio: '3:4' }, parent: 'g' },
      ...shots.flatMap((i) => {
        const y = top + i * row;
        return [
          { id: `beat${i}`, x: col(0), y, w: NOTE_W, h: MAKE_H, text: '', parent: 'g' },
          { id: `frame${i}`, x: col(1), y, w: MAKE_W, h: MAKE_H, make: 'image' as const, prompt: say('samePerson'), opts: { ratio: '16:9' }, parent: 'g' },
          { id: `clip${i}`, x: col(2), y, w: MAKE_W, h: MAKE_H, make: 'video' as const, prompt: '', opts: { ratio: '16:9' }, parent: 'g' },
        ];
      }),
      { id: 'cut', x: col(3), y: top + row, w: CUT_W, h: MAKE_H, cut: true, parent: 'g' },
    ],
    edges: [
      { id: 'e0', from: 'who', to: 'look', order: 0 },
      ...shots.flatMap((i) => [
        { id: `b${i}`, from: `beat${i}`, to: `frame${i}`, order: 0 },
        { id: `c${i}`, from: 'look', to: `frame${i}`, order: 1 },
        { id: `m${i}`, from: `frame${i}`, to: `clip${i}`, order: 0 },
        { id: `k${i}`, from: `clip${i}`, to: 'cut', order: i },
      ]),
    ],
  };
  return [
    { id: 'builtin:clip', name: say('clip'), about: say('clipAbout'), flow: ['note', 'image', 'video'], nodes: clip.nodes.length, builtIn: true, doc: clip },
    { id: 'builtin:character', name: say('character'), about: say('characterAbout'), flow: ['note', 'image', 'image'], nodes: character.nodes.length, builtIn: true, doc: character },
    { id: 'builtin:storyboard', name: say('storyboard'), about: say('storyboardAbout'), flow: ['note', 'image'], nodes: storyboard.nodes.length, builtIn: true, doc: storyboard },
    { id: 'builtin:episode', name: say('episode'), about: say('episodeAbout'), flow: ['image', 'video', 'cut'], nodes: episode.nodes.length, builtIn: true, doc: episode },
  ];
}
