# Google Antigravity Agent Integration in OpenFilm

## Overview
This document details the first-class integration of **Google Antigravity** (`agy`) into OpenFilm and OpenFilm Desktop.

With this integration, users can drive OpenFilm directly through the Antigravity coding agent in both the command line environment and the desktop chat sidebar.

---

## 1. Architecture & Protocol Design

OpenFilm Desktop's agent sidebar interacts with autonomous coding agents via the **Agent Client Protocol (ACP)** over stdio JSON-RPC.

- **Agent ID:** `antigravity`
- **Display Name:** `Google Antigravity`
- **Provider Mark:** Google (`google`)
- **Protocol:** ACP over stdio JSON-RPC (`--acp`)
- **Authentication:** Inherited from Google Antigravity / IDE (`login: null`, auto-connected when detected)
- **Permissions:** Auto-approved (`approve: true`) with full workspace access for video generation.

---

## 2. Agent Discovery & Installation Paths

The desktop discovery engine detects Antigravity automatically using `detectAgentInstallation`:

### Search Binary Names:
- `agy`
- `antigravity`

### Platform Search Locations:
- **Windows:**
  - `%LOCALAPPDATA%\agy\bin`
  - `%APPDATA%\Antigravity\bin`
  - `%LOCALAPPDATA%\Programs\Antigravity\bin`
- **macOS & Linux:**
  - `~/.antigravity/bin`
  - `~/.local/bin`
  - `/usr/local/bin`

---

## 3. Files Modified for Integration

1. `apps/desktop/src/agent-definitions.mjs`:
   - Added `antigravity` to `definitions` with download reference.
2. `apps/desktop/src/agent-installation.mjs`:
   - Configured `AGENT_PROGRAMS.antigravity` with executable names and multi-platform candidate paths.
   - Added Windows app registry and folder matching (`WINDOWS_APP_NAMES`, `WINDOWS_APP_FOLDERS`, `DESKTOP_APPS`).
3. `apps/desktop/src/agents.mjs`:
   - Added `AGENTS.antigravity` configuration block.
4. `packages/openfilm/studio/ui/src/lib/provider-marks.ts`:
   - Mapped `antigravity` to `google` in `AGENT_MARK`.
5. `apps/desktop/chat/src/components/AgentIcons.tsx`:
   - Added Antigravity mark SVG path and updated `AgentIconId`.
6. `apps/desktop/chat/src/lib/desktop-bridge.ts`:
   - Added `'antigravity'` to `LocalAgentId`.
7. `apps/desktop/chat/src/state/local-agent-store.ts`:
   - Set auto execution mode in `AGENT_FORCED_PREFS`.
8. `apps/desktop/src/agents.test.mjs` & `apps/desktop/src/agent-roster.test.mjs`:
   - Updated test assertions to verify discovery and logout mappings.

---

## 4. Verification

- All 406 desktop unit tests pass with zero errors (`node --test src/*.test.mjs`).
- Complete TypeScript typecheck passes across both `chat` and `shell` (`tsc -p chat && tsc -p shell`).

---

## 5. Windows Executable & Installer Build

OpenFilm Desktop can be packaged into Windows native binaries:
```powershell
cd apps/desktop
node scripts/release.mjs --platform=win --arch=x64
```

### Generated Artifacts:
- **Installer (NSIS Setup):**
  `apps/desktop/.release/win-x64/out/OpenFilm-Setup-x64.exe`
- **Portable / Standalone Executable:**
  `apps/desktop/.release/win-x64/out/win-unpacked/OpenFilm.exe`
- **Embedded Runtimes:**
  - FFmpeg & FFprobe (Gyan essentials static build 9.0.2)
  - Playwright Chromium Headless Shell (v1228)

