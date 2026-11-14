/**
 * What a picture or a clip is shot with, as a person picks it on the canvas (components/canvas/camera.tsx): the camera,
 * the lens, the focal length and the aperture, each said in the words an image or video model reads. Auto says
 * nothing. Pure, so `node --test` runs it.
 */

export interface CameraPart { id: string; words: string }
export interface CameraPick { body: string; lens: string; focal: string; aperture: string }

export const BODIES: readonly CameraPart[] = [
  { id: 'auto', words: '' },
  { id: 'film35', words: 'shot on a 35mm film camera, natural film grain' },
  { id: 'rangefinder', words: 'shot on a classic rangefinder film camera, crisp and candid' },
  { id: 'y2k', words: 'shot on an early-2000s compact digital camera, direct on-camera flash, slightly oversaturated colors' },
  { id: 'instant', words: 'an instant film photo, soft faded colors, gentle vignette' },
  { id: 'medium', words: 'shot on a medium format camera, rich tonal range, fine detail' },
  { id: 'cinema', words: 'shot on a digital cinema camera, cinematic color science, wide dynamic range' },
  { id: 'dv', words: 'a 1990s handheld camcorder look, soft video texture, slight interlacing' },
  { id: 'phone', words: 'shot on a smartphone camera, computational HDR, sharp and clean' },
];

export const LENSES: readonly CameraPart[] = [
  { id: 'auto', words: '' },
  { id: 'standard', words: 'a standard 50mm lens, natural perspective' },
  { id: 'wide', words: 'a wide-angle lens, expansive view, converging lines' },
  { id: 'fisheye', words: 'a fisheye lens, strong barrel distortion, circular vignette' },
  { id: 'tele', words: 'a telephoto lens, compressed perspective, creamy blurred background' },
  { id: 'macro', words: 'a macro lens, extreme close-up detail' },
  { id: 'anamorphic', words: 'an anamorphic lens, horizontal lens flares, oval bokeh, widescreen feel' },
  { id: 'tiltshift', words: 'a tilt-shift lens, miniature-like selective focus' },
  { id: 'soft', words: 'a black diffusion filter, glowing highlights, soft halation' },
];

export const FOCALS: readonly CameraPart[] = [
  { id: 'auto', words: '' },
  ...[14, 24, 35, 50, 85, 135, 200].map((mm) => ({ id: String(mm), words: `${mm}mm focal length` })),
];

export const APERTURES: readonly CameraPart[] = [
  { id: 'auto', words: '' },
  { id: '1.2', words: 'f/1.2, very shallow depth of field, dreamy bokeh' },
  { id: '1.8', words: 'f/1.8, shallow depth of field' },
  { id: '2.8', words: 'f/2.8, softly blurred background' },
  { id: '5.6', words: 'f/5.6, moderate depth of field' },
  { id: '8', words: 'f/8, most of the scene sharp' },
  { id: '11', words: 'f/11, deep depth of field, everything sharp' },
  { id: '16', words: 'f/16, deep focus, sunstars on bright lights' },
];

export const NO_CAMERA: CameraPick = { body: 'auto', lens: 'auto', focal: 'auto', aperture: 'auto' };

/** The words a pick says, in the order a photographer would: camera, lens, focal length, aperture; '' for all auto. */
export function cameraWords(pick: CameraPick): string {
  const find = (list: readonly CameraPart[], id: string) => list.find((p) => p.id === id)?.words ?? '';
  return [find(BODIES, pick.body), find(LENSES, pick.lens), find(FOCALS, pick.focal), find(APERTURES, pick.aperture)].filter(Boolean).join(', ');
}

/** Whether anything is picked beyond auto. */
export const picksAnything = (pick: CameraPick) => Object.values(pick).some((v) => v !== 'auto');
