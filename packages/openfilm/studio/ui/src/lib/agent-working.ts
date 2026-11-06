/**
 * Whether an agent is working in this page's project now: its tab of the app's window says so (lib/host.ts `tabs`).
 * Meanwhile the film may point at a file the agent is about to write or has just removed: what cannot be drawn then
 * is on its way, not broken. Without an app around Studio there is no telling, and it is false.
 */
import React from 'react';
import { studioHost, type HostTab } from '@/lib/host';

export function useAgentWorking(): boolean {
  const [working, setWorking] = React.useState(false);
  React.useEffect(() => {
    const host = studioHost?.tabs;
    if (!host) return undefined;
    let alive = true;
    let self: string | null = null;
    const read = (tabs: HostTab[]) => { if (alive) setWorking(Boolean(self && tabs.find((tab) => tab.id === self)?.working)); };
    void host.list().then((r) => { self = r.self; read(r.tabs); }, () => {});
    const stop = host.onChange(read);
    return () => { alive = false; stop(); };
  }, []);
  return working;
}
