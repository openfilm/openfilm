# Security

Studio is a server on your machine: it reads and writes your projects and keeps the keys of the media services you
connect. It listens on 127.0.0.1 only, and answers the CLI and its own pages with a key it makes at launch.

## Your keys

Your service keys are in `~/.openfilm/providers.json`, readable by your user only. In the desktop app they are sealed
there with a key that only your system's keychain opens for the app, and Studio's own key stays in the app's memory;
the agents the app runs get a key of their own that cannot change your services or settings. On macOS a program running
as you (an agent, a skill, a plugin's command) that reads those files gets nothing usable. On Windows the keychain
(DPAPI) opens to any program running as you, so there sealing protects copies of the file, not the file on your
computer. With `npx openfilm` alone the keys are kept plain, so any program running as you can read them. Your user
account is the boundary: nothing here stops a program running as you that reads Studio's memory.

## Reporting

Please report a vulnerability privately, not in a public issue: on GitHub, under **Security → Report a
vulnerability** in this repository, or by email to **support@openfilm.dev**. Say what you found, how to reproduce it,
and which version (`openfilm --version`). You will hear back within a few days, and we will tell you
when a fix is released. We credit reporters who want to be named.

Supported: the latest release on npm.
