/**
 * The clip tools that a model does (the canvas's clip toolbar, components/canvas/clip-tools.tsx): what each asks of the
 * person, its preset's words, the model made for it when one is connected, else any that takes a clip as a reference
 * and what else it needs. Pure, so `node --test` runs it.
 */
import type { ModelSpec } from './canvas.ts';

export type ClipToolKey = 'edit' | 'extend' | 'motion' | 'restyle' | 'recast' | 'lipsync';

export interface ClipTool {
  key: ClipToolKey;
  /** its words, before the person's (lib/canvas-presets.ts) */
  preset: string;
  /** the model made for it, by its id at any provider */
  own: string;
  /** what the person gives besides the clip: words, pictures, a style, a recording, a length */
  words: 'required' | 'optional';
  pictures?: 'required' | 'optional';
  style?: true;
  audio?: true;
  length?: true;
}

export const CLIP_TOOLS: readonly ClipTool[] = [
  { key: 'edit', preset: 'clipEdit', own: 'kling-o3-edit', words: 'required', pictures: 'optional' },
  { key: 'extend', preset: 'clipExtend', own: 'gemini-omni-1.2-flash', words: 'optional', length: true },
  { key: 'motion', preset: 'clipMotion', own: 'kling-o3-reference', words: 'optional', pictures: 'required' },
  { key: 'restyle', preset: 'clipRestyle', own: 'luma-ray-3.2', words: 'optional', style: true },
  { key: 'recast', preset: 'clipRecast', own: 'minimax-h3-max-recast', words: 'optional', pictures: 'required' },
  { key: 'lipsync', preset: 'clipLipsync', own: 'sync-3', words: 'optional', audio: true },
];

export interface ClipChoice { via: string; model?: string; name: string; spec?: ModelSpec }

/** whether a model is the one made for a tool (its id at any provider: `fal`'s, or through OpenFilm `openfilm/fal/…`) */
export const isOwn = (tool: ClipTool, choice: ClipChoice) => choice.model === tool.own || Boolean(choice.model?.endsWith(`/${tool.own}`));

/**
 * The models that do a tool, the one made for it first: those that take a clip as a reference besides, when they take
 * what else it needs (pictures, a recording).
 */
export function clipModels(tool: ClipTool, choices: readonly ClipChoice[]): ClipChoice[] {
  const own = choices.filter((c) => isOwn(tool, c));
  const referenced = choices.filter((c) => c.spec?.clip && !c.spec.needs && !own.includes(c)
    && (!tool.pictures || (c.spec.refs ?? 0) > 0) && (!tool.audio || Boolean(c.spec.voice)));
  return [...own, ...referenced];
}
