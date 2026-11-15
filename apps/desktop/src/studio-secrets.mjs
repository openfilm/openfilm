/**
 * Studio's secrets in the app, kept in the app's data folder sealed with the system's keychain (macOS Keychain,
 * Windows DPAPI; main.mjs `seal`): Studio's own key (`key`, 48 hex), which opens all of Studio, the person's say
 * included, and the vault (`vault`, 64 hex) the person's service keys are sealed with in providers.json (the
 * `openfilm` package's keys.mjs vaultSealer). They reach Studio's process only over its private channel
 * (studio-process.mjs), never a file, a variable or an address an agent can read.
 *
 * None (null) when the keychain is not there, or will not open what it sealed (the person refused it, another build
 * made it): Studio then keeps keys as `npx openfilm` does, plain, and sealed ones wait for the keychain to open
 * again. A new pair is made only when there is none yet, never over one that would not open.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SECRETS_FILE = 'studio-secrets';

/**
 * @param {{ dataDir: string, available: boolean, seal: (text: string) => Buffer, unseal: (data: Buffer) => string,
 *   log?: (line: string) => void }} options
 * @returns {{ key: string, vault: string } | null}
 */
export function studioSecrets({ dataDir, available, seal, unseal, log = () => {} }) {
  if (!available) return null;
  const file = join(dataDir, SECRETS_FILE);
  if (existsSync(file)) {
    try {
      const { key, vault } = JSON.parse(unseal(readFileSync(file)));
      if (/^[0-9a-f]{48}$/.test(key) && /^[0-9a-f]{64}$/.test(vault)) return { key, vault };
      log('Studio\'s secrets are not as kept: service keys stay as they are\n');
    } catch (error) {
      log(`Studio's secrets did not open (${error?.message ?? error}): service keys stay as they are\n`);
    }
    return null;
  }
  const secrets = { key: randomBytes(24).toString('hex'), vault: randomBytes(32).toString('hex') };
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, seal(JSON.stringify(secrets)), { mode: 0o600, flag: 'wx' });
  renameSync(tmp, file);
  return secrets;
}
