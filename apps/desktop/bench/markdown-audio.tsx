/** A real chat message reading its project folder from the Studio API. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from '../chat/src/components/Markdown';
import { ChatProjectContext } from '../chat/src/lib/developer';
import { ProjectFolderContext, readStudioProject } from '../chat/src/lib/studio-film';
import '../shell/shell.css';
import '../chat/src/chat.css';

function Fixture() {
  const [folder, setFolder] = React.useState<string | null>(null);
  React.useEffect(() => { void readStudioProject((window as any).audioProject.id).then(setFolder); }, []);
  (window as any).audioFolder = folder;
  return <ProjectFolderContext.Provider value={folder}>
    <ChatProjectContext.Provider value={(window as any).audioProject.path}>
      <div className="of-chat"><Markdown text={'[Voice A](assets/%E5%A3%B0%E9%9F%B3%20A.wav) [Large](assets/large.wav) [Missing](assets/missing.wav) [Parent](../outside.wav) [Encoded parent](%2e%2e/outside.wav) [Link](assets/link.wav) [Website](https://example.com/)'} /></div>
      <div id="of-chat-layer" className="of-chat" />
    </ChatProjectContext.Provider>
  </ProjectFolderContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
