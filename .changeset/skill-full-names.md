---
"openfilm": minor
---

Every skill is known by its full name, `owner/name`: `openfilm/replicate` for OpenFilm's own, `webgrs/borrow-style` for a community skill, `local/<name>` for your own and `project/<name>` for a project's. Agents always get a skill by that full name, so two skills with the same name never get mixed up and the name doesn't change from one session to the next. Claude Code gets one plugin per owner (`openfilm:replicate`, `webgrs:borrow-style`, `local:my-brand`); other agents get `openfilm-replicate`, and each skill's text opens with its full name and who made it. `openfilm skill` takes a full name; a bare name works only when one skill has it, and otherwise every match is listed by its full name. `openfilm skills` says whether an installed skill is OpenFilm's or the community's. A GitHub account named `local` or `project` becomes `github-local` or `github-project`.
