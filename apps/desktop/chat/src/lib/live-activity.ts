/**
 * The line under the running turn: "Thinking" while it thinks, nothing while a step or its words are showing,
 * "Planning next moves" in the gaps between.
 */
import React from 'react';
import { useT } from '@/i18n';
import { transcriptBusy, transcriptDoneTalking } from '@/lib/agent-transcript';
import type { LocalTranscriptStore } from '@/lib/local-agent-run';

export function useLiveActivityFromStore(store: LocalTranscriptStore, thinking = false, planning = true): string | null {
  const t = useT();
  const read = (): string => {
    const transcript = store.get();
    if (transcriptBusy(transcript)) return '';
    if (thinking) return 'act.thinking';
    return !planning || transcriptDoneTalking(transcript) ? '' : 'act.planning';
  };
  const key = React.useSyncExternalStore(store.subscribe, read, read);
  return key ? t(key) : null;
}
