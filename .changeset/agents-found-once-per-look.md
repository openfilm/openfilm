---
"@openfilm/desktop": patch
---

On Windows, looking for the agents holds the app about half as long: each agent's program is looked for once per look instead of twice, and the thousands of files that aren't there are told without making an error for each.
