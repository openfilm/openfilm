// @ts-check
/** Private, reusable voices. Remote voice IDs are bound to the connection that created/imported them.
 * One folder per voice, outside projects; source recordings are kept only for OpenFilm's service, whose voice it is. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { studioHome } from './projects.mjs';
import { writeAtomic } from './atomic.mjs';
import { recycle } from './recycle-bin.mjs';

export const VOICE_UID = /^[a-f0-9-]{36}$/;
export const voicesRoot = () => join(studioHome(), 'voices');
export const voiceFolder = (/** @type {string} */ uid) => {
  if (!VOICE_UID.test(uid)) throw new Error('Invalid voice ID.');
  return join(voicesRoot(), uid);
};

/** @typedef {{ uid: string, provider: string, voiceId: string, connection: string, name: string,
 * language: string | null, status: 'creating' | 'training' | 'ready' | 'verification' | 'failed' | 'uncertain',
 * models: string[], created: number, updated: number, kind: 'clone' | 'import',
 * preview?: string, problem?: string, consentAt?: number, engine?: string }} VoiceAsset
 * A voice of OpenFilm's service (`provider: 'openfilm'`) has no remote ID: its recording, `sample.wav` in its folder,
 * goes with each run, and `engine` is the maker the service clones it at (inworld, elevenlabs). */

export const voiceConnection = (/** @type {string} */ provider, /** @type {string} */ key) => createHash('sha256').update(`${provider}\0${key}`).digest('hex');

/** @returns {VoiceAsset[]} */
export function voiceAssets() {
  if (!existsSync(voicesRoot())) return [];
  return readdirSync(voicesRoot()).filter((uid) => VOICE_UID.test(uid)).flatMap((uid) => {
    try {
      const value = JSON.parse(readFileSync(join(voiceFolder(uid), 'voice.json'), 'utf8'));
      if (value.uid !== uid || typeof value.provider !== 'string' || typeof value.name !== 'string'
        || typeof value.connection !== 'string' || !Array.isArray(value.models)) return [];
      if (value.status === 'creating' && Date.now() - Number(value.updated) > 240_000) {
        value.status = 'uncertain';
        value.problem = 'Creation was interrupted. Check the service console or sync before creating again.';
      }
      return [/** @type {VoiceAsset} */ (value)];
    } catch { return []; }
  }).sort((a, b) => b.created - a.created);
}

/** @param {Omit<VoiceAsset, 'uid' | 'created' | 'updated'>} value */
export async function newVoice(value) {
  if (voiceAssets().length >= 1000) throw new Error('There are 1,000 saved voices. Remove some before adding another.');
  const now = Date.now();
  const asset = { ...value, uid: randomUUID(), created: now, updated: now };
  await keepVoice(asset);
  return asset;
}

/** @param {VoiceAsset} asset */
export async function keepVoice(asset) {
  await mkdir(voiceFolder(asset.uid), { recursive: true, mode: 0o700 });
  asset.updated = Date.now();
  await writeAtomic(join(voiceFolder(asset.uid), 'voice.json'), JSON.stringify(asset, null, 2), { mode: 0o600 });
}

/** A local removal only. The remote voice and the provider's billing remain the person's to manage. */
export const removeVoice = (/** @type {string} */ uid) => recycle(voiceFolder(uid), 'voice');

/** The extra IDs that can be starred, including temporarily disconnected voices. */
export const ownVoiceKeys = () => voiceAssets().map((v) => `voice:${v.provider}/my:${v.uid}`);

