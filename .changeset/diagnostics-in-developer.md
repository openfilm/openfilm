---
'openfilm': patch
'@openfilm/desktop': patch
---

Diagnostics move to Settings → Developer, which Studio now shows outside the desktop app too. Studio and the desktop app keep what went wrong (an agent that did not start or answer, or whose process ended by itself; an export that failed; an error Studio did not expect) in `logs/problems.jsonl` in Studio's home: the last two weeks, at most 500, with home paths, keys, tokens and email addresses taken out. The copied report (and `openfilm doctor`) ends with the last week's problems. Export writes a diagnostic file to the exports folder: the report, the problems, the end of each log, how the failed turns went (what was said only if you ask for it), and Codex's own warnings and errors around its problems. Settings → Developer lists the recent problems. In the desktop app, a message that failed has "Copy diagnostic report" beside its error, and so does an agent with a problem in Settings → Agents.
