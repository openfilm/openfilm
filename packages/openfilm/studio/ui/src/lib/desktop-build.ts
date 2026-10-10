/**
 * Which desktop app this computer takes: its system (macOS or Windows; any other has no app) and its chip. Chromium
 * says both outright; Safari says neither, so a Mac whose graphics are Intel's or AMD's is an Intel Mac and any other
 * Mac is Apple silicon (the website's download button decides the same way).
 */
export type DesktopSystem = 'mac' | 'win';
export type DesktopArch = 'arm64' | 'x64';

type UAData = { platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }> };
const uaData = (): UAData | undefined => (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { userAgentData?: UAData }).userAgentData);

/** This computer's system, or null when there is no desktop app for it. */
export function desktopSystem(): DesktopSystem | null {
  if (typeof navigator === 'undefined') return null;
  const platform = `${uaData()?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`.toLowerCase();
  if (/iphone|ipad|android/.test(platform)) return null;
  if (/mac/.test(platform)) return 'mac';
  if (/win/.test(platform)) return 'win';
  return null;
}

/** A Mac's chip, from its graphics. */
function macChip(): DesktopArch {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    return /intel|amd|radeon/i.test(renderer) ? 'x64' : 'arm64';
  } catch {
    return 'arm64';
  }
}

/** The system and chip whose installer this computer takes, or null when there is no desktop app for it. */
export async function desktopBuild(): Promise<{ os: DesktopSystem; arch: DesktopArch } | null> {
  const os = desktopSystem();
  if (!os) return null;
  let arch: DesktopArch | null = null;
  try {
    const values = await uaData()?.getHighEntropyValues?.(['architecture', 'bitness']);
    if (values?.architecture) arch = values.architecture === 'arm' && values.bitness !== '32' ? 'arm64' : 'x64';
  } catch { /* not Chromium */ }
  return { os, arch: arch ?? (os === 'mac' ? macChip() : 'x64') };
}
