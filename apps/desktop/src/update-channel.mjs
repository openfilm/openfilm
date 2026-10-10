/**
 * Which builds this computer gets: 'stable' (everyone's) or 'beta' (builds before they go to everyone), chosen in the
 * app menu and kept in the app's data (update-channel.json).
 *
 * Both are in the one feed folder the app was built with (scripts/release.mjs): stable is electron-updater's 'latest'
 * channel (latest-mac.yml, latest.yml on Windows), beta its 'beta' channel (beta-mac.yml, beta.yml). The release
 * pipeline puts a build on beta first and promotes the same bytes to stable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const UPDATE_CHANNELS = Object.freeze(['stable', 'beta']);

const file = (dataDir) => join(dataDir, 'update-channel.json');

/** The channel chosen here; stable when none was, or the file is unreadable. */
export function readUpdateChannel(dataDir) {
  try {
    const saved = JSON.parse(readFileSync(file(dataDir), 'utf8')).channel;
    return UPDATE_CHANNELS.includes(saved) ? saved : 'stable';
  } catch { return 'stable'; }
}

export function writeUpdateChannel(dataDir, channel) {
  if (!UPDATE_CHANNELS.includes(channel)) throw new Error(`no update channel ${channel}`);
  writeFileSync(file(dataDir), `${JSON.stringify({ channel })}\n`);
}

/**
 * Point electron-updater at a channel's feed file. Setting `channel` turns allowDowngrade on (electron-updater's own
 * rule, for leaving a beta): it is turned off again, so moving to stable keeps a beta build until stable passes it.
 */
export function useUpdateChannel(updater, channel) {
  updater.channel = channel === 'beta' ? 'beta' : 'latest';
  updater.allowDowngrade = false;
}
