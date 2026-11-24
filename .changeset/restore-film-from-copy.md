---
"openfilm": patch
"@openfilm/desktop": patch
---

`openfilm restore <copy>` puts a project's film.html back from a copy kept elsewhere. Before, copying a backup over film.html while Studio had the project open got the person's edits merged back in, so a project couldn't be restored from the command line. The copy is now taken as it is, as a version restored in Studio's Version history is, and what Studio had is kept aside in the project's history.
