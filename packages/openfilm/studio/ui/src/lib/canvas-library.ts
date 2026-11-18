/**
 * The canvas's material libraries: styles a picture is made in, and effects (camera moves, ways of shooting) a clip is
 * made with. Each is OpenFilm's own words, in English as every model reads it, put on the board as a text node wired
 * into the picture or clip it is for. Their names and what they say are the interface's (canvas.styles, canvas.effects).
 * What the person liked and used last is kept in this browser.
 */
export type StyleGroup = 'photo' | 'illustration' | 'three' | 'design' | 'art';
export type EffectGroup = 'move' | 'drone' | 'time' | 'feel';

export interface LibraryItem<G extends string> {
  id: string;
  group: G;
  words: string;
  /** a style's two colors, its card's until its picture is in */
  look?: string;
}

export const STYLE_GROUPS: StyleGroup[] = ['photo', 'illustration', 'three', 'design', 'art'];
export const STYLES: Array<LibraryItem<StyleGroup>> = [
  { id: 'film', group: 'photo', look: '#c08a4f,#3b2a1f', words: 'shot on 35mm film, natural film grain, soft warm highlights, slightly faded blacks, true-to-life color' },
  { id: 'cinema', group: 'photo', look: '#1f4e5f,#e0a458', words: 'cinematic film still, anamorphic widescreen look, motivated lighting, teal and orange grade, shallow depth of field' },
  { id: 'documentary', group: 'photo', look: '#d9d9d9,#1c1c1c', words: 'black and white documentary photograph, available light, high contrast, candid moment, visible grain' },
  { id: 'portrait', group: 'photo', look: '#e8cfc0,#5a4636', words: 'studio portrait photograph, soft key light with a gentle fill, clean seamless backdrop, crisp detail on the eyes' },
  { id: 'product', group: 'photo', look: '#f4f4f4,#9aa5b1', words: 'commercial product photograph, clean studio light, soft reflections, seamless background, sharp and color accurate' },
  { id: 'watercolor', group: 'illustration', look: '#8fc1d4,#f3e3c3', words: 'watercolor illustration, soft washes bleeding into each other, visible paper texture, light pencil lines' },
  { id: 'oil', group: 'illustration', look: '#7a4b2a,#d9b26f', words: 'classical oil painting, rich impasto brushstrokes, warm glazes, painterly light' },
  { id: 'sketch', group: 'illustration', look: '#f2f0ea,#55524c', words: 'graphite pencil sketch on cream paper, confident lines, light cross-hatching, unfinished edges' },
  { id: 'flat', group: 'illustration', look: '#ff8a65,#4db6ac', words: 'flat vector illustration, simple shapes, limited bright palette, no gradients, clean edges' },
  { id: 'anime', group: 'illustration', look: '#7fa7ff,#ffd1e8', words: 'hand-drawn anime style, cel shading, clean line art, expressive eyes, painted sky background' },
  { id: 'comic', group: 'illustration', look: '#ffd23f,#ee4266', words: 'American comic book style, bold ink outlines, halftone dots, dramatic shadows, vivid flat colors' },
  { id: 'clay', group: 'three', look: '#f6b38e,#8ecae6', words: 'claymation look, handmade plasticine figures, fingerprint texture, soft studio light, miniature set' },
  { id: 'toon3d', group: 'three', look: '#ffb703,#219ebc', words: 'stylized 3D animated film look, soft global illumination, rounded friendly shapes, subsurface skin' },
  { id: 'lowpoly', group: 'three', look: '#90be6d,#577590', words: 'low-poly 3D render, faceted geometry, flat shading, pastel palette, clean isometric light' },
  { id: 'miniature', group: 'three', look: '#a3c4bc,#f2cc8f', words: 'tilt-shift miniature diorama, tiny detailed models, strong background blur, bright toy-like colors' },
  { id: 'poster', group: 'design', look: '#fefae0,#283618', words: 'minimalist poster design, bold composition, generous negative space, two or three flat colors' },
  { id: 'retro', group: 'design', look: '#e76f51,#264653', words: '1970s retro print, warm faded inks, rounded shapes, risograph texture' },
  { id: 'neon', group: 'design', look: '#ff00a8,#00e5ff', words: 'neon cyberpunk night, glowing signs, wet reflective streets, magenta and cyan light, haze' },
  { id: 'fashion', group: 'photo', look: '#7a1f2b,#f2c38b', words: 'high fashion editorial photograph, bold styling, dramatic light, striking poses' },
  { id: 'street', group: 'photo', look: '#4a5560,#c9b79c', words: 'candid street photography, layered composition, decisive moment, natural light' },
  { id: 'food', group: 'photo', look: '#8a4b1e,#f3d9a4', words: 'appetizing food photography, soft window light, shallow depth of field, rich textures' },
  { id: 'architecture', group: 'photo', look: '#5d7fa3,#e8e6e1', words: 'architectural photography, clean lines, strong geometry, corrected verticals' },
  { id: 'wildlife', group: 'photo', look: '#3d4a2f,#d9c7a1', words: 'wildlife photography, long lens, natural light, the animal sharp against a soft background' },
  { id: 'aerial', group: 'photo', look: '#2f6b4f,#e0a85a', words: 'aerial drone photography seen from above, vivid patterns, a sense of scale' },
  { id: 'ink', group: 'illustration', look: '#f3efe6,#2b2b2b', words: 'traditional Chinese ink wash painting, flowing brushwork, generous white space' },
  { id: 'ukiyoe', group: 'illustration', look: '#1f4e79,#e8d5b0', words: 'ukiyo-e woodblock print style, flat colors, bold outlines, patterned waves' },
  { id: 'picturebook', group: 'illustration', look: '#e9b872,#7aa874', words: 'gouache picture book illustration for children, warm, cozy, soft textures' },
  { id: 'pixel', group: 'illustration', look: '#2d1b4e,#f4a259', words: '16-bit pixel art, limited palette, crisp pixels, retro game look' },
  { id: 'crayon', group: 'illustration', look: '#fff3c4,#ff6b6b', words: 'child-like crayon drawing on paper, wobbly lines, bright colors' },
  { id: 'manga', group: 'illustration', look: '#f2f2f2,#222222', words: 'black and white manga art, screentones, speed lines, expressive ink' },
  { id: 'chalk', group: 'illustration', look: '#20302a,#f1e7c6', words: 'colorful chalk drawing on a blackboard, dusty strokes' },
  { id: 'voxel', group: 'three', look: '#58c4dd,#ffd166', words: 'voxel art 3D render, cube blocks, bright colors, clean lighting' },
  { id: 'papercraft', group: 'three', look: '#a8dadc,#f4a261', words: 'layered papercraft, paper cut-outs, soft shadows between paper layers' },
  { id: 'isometric', group: 'three', look: '#cdb4db,#8ecae6', words: 'isometric 3D illustration, soft lighting, clean shapes, tidy details' },
  { id: 'glass', group: 'three', look: '#1b1f3a,#9be7ff', words: 'frosted glass material 3D render, iridescent refractions, soft caustics' },
  { id: 'cgi', group: 'three', look: '#1d2b3a,#e0b26f', words: 'photorealistic CGI render, cinematic lighting, highly detailed' },
  { id: 'vaporwave', group: 'design', look: '#ff9ad5,#5ef2f0', words: 'vaporwave aesthetic, pastel pink and teal, retro computer graphics, palm trees and grids' },
  { id: 'bauhaus', group: 'design', look: '#e63946,#f1c40f', words: 'Bauhaus design, primary colors, simple geometric shapes, balanced composition' },
  { id: 'artdeco', group: 'design', look: '#0b2545,#d4af37', words: 'Art Deco style, gold and navy, symmetrical geometry, sunburst motifs' },
  { id: 'y2k', group: 'design', look: '#ff8fd8,#c0c0c0', words: 'Y2K aesthetic, glossy chrome, bubbles and butterflies, futuristic gradients' },
  { id: 'collage', group: 'design', look: '#e9d8a6,#3d5a80', words: 'mixed-media collage, paper cut-outs, torn edges, halftone textures' },
  { id: 'impressionism', group: 'art', look: '#9bc1bc,#f4e285', words: 'impressionist painting, visible dabs of color, shimmering light' },
  { id: 'popart', group: 'art', look: '#ffde00,#e4002b', words: 'pop art, bold Ben-Day dots, primary colors, thick outlines' },
  { id: 'surreal', group: 'art', look: '#6c5b7b,#f8b195', words: 'surrealist painting, dreamlike, uncanny juxtapositions' },
  { id: 'stainedglass', group: 'art', look: '#1e3d59,#ff6e40', words: 'stained glass art, glowing jewel colors, lead lines' },
  { id: 'graffiti', group: 'art', look: '#2b2d42,#ef476f', words: 'graffiti street art, spray paint, drips, bold colors on a wall' },
];

export const EFFECT_GROUPS: EffectGroup[] = ['move', 'drone', 'time', 'feel'];
export const EFFECTS: Array<LibraryItem<EffectGroup>> = [
  { id: 'pushIn', group: 'move', words: 'the camera slowly dollies in toward the subject, steady and smooth, the background gently compressing' },
  { id: 'pullOut', group: 'move', words: 'the camera slowly dollies back, revealing more of the surroundings around the subject' },
  { id: 'orbit', group: 'move', words: 'the camera orbits around the subject in a smooth half circle, keeping it centered' },
  { id: 'track', group: 'move', words: 'the camera tracks alongside the subject at the same speed, parallel to its movement' },
  { id: 'follow', group: 'move', words: 'the camera follows the subject from behind at shoulder height, moving with it' },
  { id: 'whip', group: 'move', words: 'a fast whip pan with motion blur that lands on the next subject' },
  { id: 'dollyZoom', group: 'move', words: 'a dolly zoom: the camera moves in while zooming out, the subject stays the same size and the background stretches away' },
  { id: 'craneUp', group: 'drone', words: 'the camera cranes up and away, rising above the scene to a high wide view' },
  { id: 'dive', group: 'drone', words: 'an aerial drone shot diving down toward the subject from high above' },
  { id: 'clouds', group: 'drone', words: 'the camera flies forward through clouds and breaks out above the landscape below' },
  { id: 'fpv', group: 'drone', words: 'a fast FPV drone flight weaving close through the scene, dynamic banking turns' },
  { id: 'slowMo', group: 'time', words: 'slow motion at high frame rate, every detail of the movement visible' },
  { id: 'timelapse', group: 'time', words: 'a time-lapse: light and shadows sweep across the scene, clouds race by, people blur' },
  { id: 'bulletTime', group: 'time', words: 'bullet time: the action freezes mid-moment while the camera circles around it' },
  { id: 'handheld', group: 'feel', words: 'handheld camera, subtle natural shake, documentary feel, close to the action' },
  { id: 'pov', group: 'feel', words: 'first-person point of view, as seen through the eyes of the character, hands sometimes in frame' },
  { id: 'rack', group: 'feel', words: 'a rack focus from the foreground to the subject behind it' },
];

export type LibraryKind = 'styles' | 'effects';
const KEY = 'openfilm.canvas.library';
type Kept = Record<LibraryKind, { fav: string[]; recent: string[] }>;
const empty = (): Kept => ({ styles: { fav: [], recent: [] }, effects: { fav: [], recent: [] } });
function read(): Kept {
  try { return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Kept>) }; } catch { return empty(); }
}
function write(kept: Kept) { try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* not kept */ } }
export const libraryKept = (kind: LibraryKind) => read()[kind];
export function toggleFavorite(kind: LibraryKind, id: string) {
  const kept = read();
  const fav = kept[kind].fav;
  kept[kind].fav = fav.includes(id) ? fav.filter((f) => f !== id) : [id, ...fav];
  write(kept);
}
export function noteUsed(kind: LibraryKind, id: string) {
  const kept = read();
  kept[kind].recent = [id, ...kept[kind].recent.filter((r) => r !== id)].slice(0, 24);
  write(kept);
}
