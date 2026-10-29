/** The real prompt editor on a page of its own, with a file pill and a moment pill to move about. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { promptReferenceToken } from '@openfilm/shared';
import { PromptEditor, type PromptEditorHandle, type PromptReference } from '../chat/src/components/prompt-editor';
import '../shell/shell.css';
import '../chat/src/chat.css';

const references: PromptReference[] = [
  { id: 'file:assets/strip.jpg', kind: 'file', label: 'strip.jpg', detail: '32 KB' },
  { id: 'studio:time:4', kind: 'time', label: '0:04' },
];

function Fixture() {
  const editor = React.useRef<PromptEditorHandle>(null);
  const text = React.useRef('');
  const revealed = React.useRef<string[]>([]);
  (window as any).pillsFixture = {
    set: (value: string) => editor.current?.setText(value),
    /* as a file dropped from Finder lands: at the point it was let go */
    dropAt: (id: string, x: number, y: number) => editor.current?.insertReferences(references.filter((r) => r.id === id), { x, y }),
    token: promptReferenceToken,
    /* the text with each pill as [its id] */
    text: () => text.current.replace(/⁣([^⁣]+)⁣/g, '[$1]'),
    revealed: () => revealed.current,
  };
  return (
    <div className="of-chat" style={{ padding: 40, width: 520 }}>
      <button type="button" id="elsewhere">Elsewhere</button>
      <div style={{ marginTop: 24, border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
        <PromptEditor
          ref={editor}
          defaultValue=""
          references={references}
          onChange={(state) => { text.current = state.text; }}
          onReveal={(reference) => { revealed.current.push(reference.id); }}
          revealLabel="Show in Studio"
          removeLabel="Remove"
          placeholder="Ask"
          minHeight={22}
          maxHeight={158}
          contentClassName="text-[14px] leading-[22px] text-[var(--chat-text)]"
          showsDropCaret={(data) => [...data.types].includes('Files')}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
