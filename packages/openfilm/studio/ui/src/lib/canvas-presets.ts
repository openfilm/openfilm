/**
 * Ways to ask for a picture that come with the canvas ("presets"): each a set of words put before the node's own (a
 * character's turnaround, a 2×2 of what happens next, the same moment from nine cameras…), the shape and quality it
 * is best made at, and whether it is made from a picture wired in. Picked in a picture node's panel, it shows as a tag
 * before its words and names the node. Their words are OpenFilm's own, in English: every picture model reads it.
 */
/** `character`: the pictures a new character is made of (canvas libraries), not offered in the presets' list */
export type PresetGroup = 'story' | 'texture' | 'camera' | 'design' | 'character';

export interface CanvasPreset {
  id: string;
  group: PresetGroup;
  /** made from a picture wired in: offered only when one is */
  fromPicture?: boolean;
  ratio: string;
  quality?: 'high';
  prompt: string;
}

export const PRESET_GROUPS: PresetGroup[] = ['story', 'texture', 'camera', 'design'];

export const PRESETS: CanvasPreset[] = [
  { id: 'storyboard', group: 'story', ratio: '16:9', prompt: 'A storyboard sheet of six consecutive shots of this scene in a 3×2 grid with thin white gutters, each panel a clear cinematic frame with its own camera angle, the same characters, setting, costume and light throughout, readable as one continuous sequence.' },
  { id: 'grid25', group: 'story', ratio: '1:1', quality: 'high', prompt: 'A 5×5 grid of 25 consecutive storyboard frames telling this moment from start to end, thin white gutters, the same characters, setting and light in every frame, the action advancing a little from frame to frame.' },
  { id: 'next4', group: 'story', fromPicture: true, ratio: '16:9', prompt: 'A 2×2 grid of the four moments that follow the reference picture, in order from top left, the same characters, setting, lighting and style, the story moving forward naturally, thin white gutters.' },
  { id: 'later3', group: 'story', fromPicture: true, ratio: '16:9', prompt: 'The same scene three seconds after the reference picture: continue the action naturally, keep the characters, their clothes, the setting, the light and the camera exactly as they are.' },
  { id: 'earlier5', group: 'story', fromPicture: true, ratio: '16:9', prompt: 'The same scene five seconds before the reference picture: show what led to it, keep the characters, their clothes, the setting, the light and the camera exactly as they are.' },
  { id: 'skin', group: 'texture', fromPicture: true, ratio: '16:9', quality: 'high', prompt: 'Retouch the person in the reference picture to look like a real photograph: natural skin texture with fine pores and soft highlights, real hair strands, no plastic smoothing; keep the face, expression, pose, clothes and framing exactly the same.' },
  { id: 'cinematic', group: 'texture', fromPicture: true, ratio: '16:9', quality: 'high', prompt: 'Relight the reference picture as a film still: motivated cinematic lighting with soft key light and gentle contrast, natural color grading and subtle film grain; keep every person, object, pose and the framing exactly the same.' },
  { id: 'panorama', group: 'camera', ratio: '2:1', quality: 'high', prompt: 'A seamless 360° equirectangular panorama of this place, eye level, the horizon straight across the middle, even exposure all around, no people in the way.' },
  { id: 'cameras9', group: 'camera', ratio: '1:1', quality: 'high', prompt: 'A 3×3 grid of the same moment seen from nine camera positions — wide, medium and close; eye level, high and low; front, three-quarter and side — the same characters, pose, setting and light in every panel, thin white gutters.' },
  { id: 'turnaround', group: 'design', ratio: '21:9', quality: 'high', prompt: 'A character turnaround sheet on a plain white background: full-body front, side and back views side by side and a front close-up portrait, the same face, hair, body and outfit in every view, even studio light, no text.' },
  { id: 'faces', group: 'design', ratio: '21:9', quality: 'high', prompt: 'A head turnaround of the same person on a plain white background: front, three-quarter and profile close-ups side by side, neutral expression, the same face, hair and skin in every view, even studio light, no text.' },
  { id: 'character', group: 'design', ratio: '16:9', quality: 'high', prompt: 'A character design sheet: a full-body front view, four expression close-ups, details of the outfit, shoes and props, and a small color palette, neatly laid out on a light background, the same person throughout.' },
  { id: 'scene', group: 'design', ratio: '16:9', quality: 'high', prompt: 'An environment design sheet of this place: one wide establishing view and three detail views of its key spots, consistent architecture, materials and light, neatly laid out on a light background.' },
  { id: 'portrait', group: 'character', ratio: '1:1', quality: 'high', prompt: 'A head-and-shoulders portrait of this character facing the camera on a plain white background, neutral expression, even studio light, sharp detail, no text.' },
  { id: 'fullBody', group: 'character', ratio: '9:16', quality: 'high', prompt: 'A full-body picture of this character standing facing the camera on a plain white background, relaxed pose, the whole outfit and shoes visible, even studio light, no text.' },
  { id: 'expressions', group: 'character', ratio: '1:1', quality: 'high', prompt: 'A 3×3 grid of close-ups of this character showing nine expressions — calm, happy, laughing, sad, angry, surprised, scared, thinking, tired — the same face, hair and light in every panel, plain white background, thin white gutters, no text.' },
  { id: 'turnaround16', group: 'character', ratio: '16:9', quality: 'high', prompt: 'A turnaround sheet of this character on a plain white background: full-body front, three-quarter, side and back views in a row and three head close-ups from different angles, the same face, hair and outfit in every view, even studio light, no text.' },
  { id: 'product', group: 'design', ratio: '16:9', quality: 'high', prompt: 'A product design sheet on a plain white background: front, side, back and three-quarter views of the same product, even studio light, accurate proportions and materials, no text.' },
];

export const presetOf = (id: string | undefined): CanvasPreset | undefined => (id ? PRESETS.find((p) => p.id === id) : undefined);
