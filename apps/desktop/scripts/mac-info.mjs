/**
 * What the Mac app's Info.plist says of the network and of what it asks the person for, as Claude's desktop app says it.
 *
 *   · App Transport Security: the app's own system connections (Squirrel.Mac fetching an update, through NSURLSession)
 *     are encrypted, except to this computer and its network. electron-builder writes `NSAllowsArbitraryLoads: true`
 *     after `extendInfo` is applied (electronMac.js configureLocalhostAts, "required for electron-updater proxy"), so it
 *     is set again here, after packing and before signing (`strictTransport`). electron-updater's proxy is on
 *     127.0.0.1, which `NSAllowsLocalNetworking` lets through: Squirrel.Mac reaches it, and is refused plain http to the
 *     web (measured on Electron 44 with a feed at 127.0.0.1, at localhost and at http://example.com). Web pages, Studio
 *     and the agents do not go through ATS: Chromium and Node have networks of their own.
 *   · What macOS says when the app first asks for something: each key Electron's own Info.plist brings, in words of
 *     ours, never Electron's "This app needs access to …". What OpenFilm does not use says so, so the person can say no.
 */
import { execFileSync } from 'node:child_process';

export const TRANSPORT = Object.freeze({ NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true });

/** `mac.extendInfo`: what macOS shows when the app asks (the entitlements let it ask: build/entitlements.mac.plist). */
export const USAGE = Object.freeze({
  NSMicrophoneUsageDescription: 'OpenFilm records sound from the microphone when you press Record, and uses it for sites you allow in its browser.',
  NSCameraUsageDescription: 'OpenFilm uses the camera only for sites you allow in its browser.',
  NSAudioCaptureUsageDescription: 'OpenFilm doesn’t record your computer’s sound. If macOS asks, you can say no.',
  NSBluetoothAlwaysUsageDescription: 'OpenFilm doesn’t use Bluetooth. If macOS asks, you can say no.',
  NSBluetoothPeripheralUsageDescription: 'OpenFilm doesn’t use Bluetooth. If macOS asks, you can say no.',
});

/** The app's Info.plist made to say TRANSPORT, and read back to be sure. @param {string} plist the file */
export function strictTransport(plist) {
  execFileSync('/usr/bin/plutil', ['-replace', 'NSAppTransportSecurity', '-json', JSON.stringify(TRANSPORT), plist]);
  const now = JSON.parse(execFileSync('/usr/bin/plutil', ['-extract', 'NSAppTransportSecurity', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  if (JSON.stringify(now) !== JSON.stringify(TRANSPORT)) throw new Error(`${plist}: NSAppTransportSecurity is ${JSON.stringify(now)}`);
}
