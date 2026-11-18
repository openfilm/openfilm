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

## Community items

Workbenches, skills and connectors from the community run on your computer. OpenFilm keeps them in bounds where it can:

- A project's own skills reach no agent until you allow them in that project, after reading them whole; if their
  files change, you are asked again.
- A workbench's page reaches no network address except the hosts its `openfilm.json` declares, and it is told what it
  may reach before you turn it on.
- A skill made by anyone but OpenFilm that brings scripts asks before it is installed or tried: its scripts run with
  your agent's access.
- Anything OpenFilm withdraws (malware, impersonation, rights, broken, policy) stops on every computer the next time
  the community index is read, wherever a copy of it is, and says why.
- Another community index you add (Community sources) is not reviewed by OpenFilm: what it lists is marked
  Unreviewed, asks before it is installed, never takes the place of an OpenFilm Community item, and cannot withdraw
  anything.
- Installing an item from the OpenFilm Community sends its id (`owner/name`) to openfilm.dev to count how many use
  it, and nothing about you; `OPENFILM_NO_STATS=1` turns it off.

To report a community item, use **Report** on its page in OpenFilm or on openfilm.dev (the community's
[report form](https://github.com/openfilm/community/issues/new?template=report.yml)), or write to
**support@openfilm.dev** with its name (`owner/name`) and what you saw. A confirmed malicious item is withdrawn within
24 hours of confirmation, and an advisory says how to check whether you were affected and what to do.

## Reporting

Please report a vulnerability privately, not in a public issue: on GitHub, under **Security → Report a
vulnerability** in this repository, or by email to **support@openfilm.dev**. Say what you found, how to reproduce it,
and which version (`openfilm --version`). You will hear back within a few days, and we will tell you
when a fix is released. We credit reporters who want to be named.

Supported: the latest release on npm.
