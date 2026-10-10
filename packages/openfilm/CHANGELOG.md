# openfilm

## 0.1.4

### Patch Changes

- f486188: Windows: an ffmpeg that is stopped (a cancelled render or export, a mix that runs too long) ends with the real ffmpeg
  behind a Chocolatey or Scoop shim; a name with a `:` is cleaned on import, rename and new folders as on macOS and
  Linux, not refused; Studio's supervisor opens the null device by its Windows name.

## 0.1.3

The first release from the open-source repository: the CLI, Studio and the desktop app share this version.

- Media comes only from services you connect with your own key, in Studio's Settings → Providers or from the environment. There are more of them, at least one for every kind of media: ElevenLabs, OpenAI, Google Gemini and fal.ai, now with Groq (fast transcripts with Whisper, voice-over with Orpheus), Pexels and Pixabay (image search), Brave Search and Tavily (web search and reading pages); fal.ai also makes music and sound effects. `openfilm get` names the services that make each kind you have not connected yet.
- Settings → Providers: every service is Connect or Disconnect. A key pasted in Studio wins over one in the environment, which connects its service unless disconnected.
- Studio's Projects page starts from an existing film: Import from a folder, or from GitHub (a repository or a folder in one, without its git history), and a row of example films. `openfilm open <github url>` does the same. A project whose folder moved can be located again.
- A Studio started by `openfilm open` that ends unexpectedly starts again by itself, on the same address; pages reconnect.
- Settings → General shows Studio's version and checks npm for a newer one.
- The Desktop dialog shows what the app does and the agents it works with, and downloads the installer for this computer.
- The desktop app's chat runs your own agents (Codex, Claude Code, Gemini CLI, GitHub Copilot, Cursor, OpenCode and others) or its own agent on your own API key.
