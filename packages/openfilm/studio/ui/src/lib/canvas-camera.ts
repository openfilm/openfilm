/**
 * What a picture or a clip is shot with, as a person picks it on the canvas (components/canvas/camera.tsx): the camera,
 * the lens, the focal length and the aperture, each said in the words an image or video model reads. Auto says
 * nothing. Pure, so `node --test` runs it.
 */

export interface CameraPart { id: string; words: string }
export interface CameraPick { body: string; lens: string; focal: string; aperture: string }

export const BODIES: readonly CameraPart[] = [
  { id: 'auto', words: '' },
  { id: 'film35', words: 'shot on a 35mm film camera, natural film grain, true-to-life color' },
  { id: 'rangefinder', words: 'shot on a classic rangefinder film camera, crisp and candid' },
  { id: 'halfframe', words: 'shot on a half-frame film camera, soft grain, slightly faded warm color' },
  { id: 'disposable', words: 'a disposable film camera snapshot, harsh direct flash, faded colors' },
  { id: 'toy', words: 'shot on a plastic toy camera, heavy vignette, light leaks, soft edges, saturated colors' },
  { id: 'instant', words: 'an instant film photo, soft faded colors, creamy highlights, gentle vignette' },
  { id: 'y2k', words: 'shot on an early-2000s compact digital camera, direct on-camera flash, slightly oversaturated colors' },
  { id: 'mirrorless', words: 'shot on a full-frame mirrorless camera, clean, sharp, rich detail' },
  { id: 'medium', words: 'shot on a medium format camera, rich tonal range, fine detail' },
  { id: 'largeformat', words: 'shot on a large format view camera, extreme detail, a tilted plane of focus' },
  { id: 'pinhole', words: 'a pinhole camera photo, soft overall focus, strong vignette, long exposure ghosting' },
  { id: 'cinema', words: 'shot on a digital cinema camera, cinematic color science, wide dynamic range' },
  { id: 'film16', words: 'shot on 16mm motion picture film, heavy grain, soft contrast' },
  { id: 'dv', words: 'a 1990s handheld camcorder look, soft video texture, slight interlacing' },
  { id: 'action', words: 'shot on an action camera, wide distortion, punchy colors' },
  { id: 'drone', words: 'an aerial drone shot from above' },
  { id: 'phone', words: 'shot on a smartphone camera, computational HDR, sharp and clean' },
  { id: 'cctv', words: 'a grainy black and white security camera frame from a high corner, wide distortion' },
];

export const LENSES: readonly CameraPart[] = [
  { id: 'auto', words: '' },
  { id: 'standard', words: 'a standard 50mm lens, natural perspective' },
  { id: 'wide', words: 'a wide-angle lens, expansive view, converging lines' },
  { id: 'ultrawide', words: 'an ultra wide-angle lens, dramatic perspective, strongly converging lines' },
  { id: 'fisheye', words: 'a fisheye lens, strong barrel distortion, circular vignette' },
  { id: 'tele', words: 'a telephoto lens, compressed perspective, creamy blurred background' },
  { id: 'supertele', words: 'a super-telephoto lens from far away, extremely compressed background' },
  { id: 'macro', words: 'a macro lens, extreme close-up detail' },
  { id: 'anamorphic', words: 'an anamorphic lens, horizontal lens flares, oval bokeh, widescreen feel' },
  { id: 'tiltshift', words: 'a tilt-shift lens, miniature-like selective focus' },
  { id: 'soft', words: 'a black diffusion filter, glowing highlights, soft halation' },
  { id: 'vintage', words: 'a vintage lens, swirly bokeh, soft glow, lower contrast' },
  { id: 'probe', words: 'a probe lens close to the ground, an insect-eye perspective' },
  { id: 'star', words: 'a star filter, bright lights turned into stars' },
  { id: 'infrared', words: 'infrared photography, white foliage, dark sky, surreal tones' },
];

export const FOCALS: readonly CameraPart[] = [
  { id: 'auto', words: '' },
  ...[8, 14, 18, 24, 35, 50, 85, 105, 135, 200, 400].map((mm) => ({ id: String(mm), words: `${mm}mm focal length` })),
];

/** apertures by f-number, a dot written `_` (an id is also a key of the names) */
export const APERTURES: readonly CameraPart[] = [
  { id: 'auto', words: '' },
  { id: '0_95', words: 'f/0.95, only the eyes in focus, everything else melting into creamy bokeh' },
  { id: '1_4', words: 'f/1.4, very shallow depth of field' },
  { id: '2', words: 'f/2, shallow depth of field, blurred background' },
  { id: '2_8', words: 'f/2.8, softly blurred background' },
  { id: '4', words: 'f/4, a slightly soft background' },
  { id: '5_6', words: 'f/5.6, moderate depth of field' },
  { id: '8', words: 'f/8, most of the scene sharp' },
  { id: '11', words: 'f/11, deep depth of field, everything sharp' },
  { id: '16', words: 'f/16, everything sharp, small sunstars on lights' },
  { id: '22', words: 'f/22, deep focus, crisp sunstars on lights' },
];

export const NO_CAMERA: CameraPick = { body: 'auto', lens: 'auto', focal: 'auto', aperture: 'auto' };

/** The words a pick says, in the order a photographer would: camera, lens, focal length, aperture; '' for all auto. */
export function cameraWords(pick: CameraPick): string {
  const find = (list: readonly CameraPart[], id: string) => list.find((p) => p.id === id)?.words ?? '';
  return [find(BODIES, pick.body), find(LENSES, pick.lens), find(FOCALS, pick.focal), find(APERTURES, pick.aperture)].filter(Boolean).join(', ');
}

/** Whether anything is picked beyond auto. */
export const picksAnything = (pick: CameraPick) => Object.values(pick).some((v) => v !== 'auto');

/** A pick as a node keeps it (`body|lens|focal|aperture`), and read back; a part not given, or not on its list, is auto. */
export const cameraText = (pick: CameraPick) => [pick.body, pick.lens, pick.focal, pick.aperture].join('|');
export function cameraOf(text: string | undefined): CameraPick {
  const parts = (text ?? '').split('|');
  const part = (list: readonly CameraPart[], i: number) => (list.some((p) => p.id === parts[i]) ? parts[i]! : 'auto');
  return { body: part(BODIES, 0), lens: part(LENSES, 1), focal: part(FOCALS, 2), aperture: part(APERTURES, 3) };
}
