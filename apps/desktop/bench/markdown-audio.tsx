/** Audio links in a real chat message, with only the native bridge replaced. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from '../chat/src/components/Markdown';
import { ChatProjectContext } from '../chat/src/lib/developer';
import '../shell/shell.css';
import '../chat/src/chat.css';

createRoot(document.getElementById('root')!).render(
  <ChatProjectContext.Provider value="/example/film">
    <div className="of-chat"><Markdown text={'[Voice A](../voice_auditions/voice%20A.wav) and [Website](https://example.com/) and [Missing](assets/missing.wav)'} /></div>
    <div id="of-chat-layer" className="of-chat" />
  </ChatProjectContext.Provider>,
);
