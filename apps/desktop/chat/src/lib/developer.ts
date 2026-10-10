/**
 * Settings → Developer, as the chat follows it: on, each turn shows its full log (components/TurnLog.tsx). The app
 * keeps the choice; Studio's Settings switches it.
 */
import React from 'react';
import { app } from '../app-bridge';

let on = false;
const listeners = new Set<() => void>();
const set = (next: boolean) => { if (next === on) return; on = next; for (const listener of listeners) listener(); };
let started = false;
function start() {
  if (started) return;
  started = true;
  void app.developer.get().then(set).catch(() => {});
  app.developer.onChange(set);
}

export function useDeveloperMode(): boolean {
  start();
  return React.useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => on, () => false);
}

/** The project the chat shows (its folder): where a turn's log is. */
export const ChatProjectContext = React.createContext<string | null>(null);

/** Whether something waits for the person's answer now (a question, a permission, a spend): the status line says so. */
export const WaitingContext = React.createContext(false);
