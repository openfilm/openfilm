---
"@openfilm/desktop": patch
"openfilm": patch
---

Desktop: Your own key works again. The 0.1.7 installer carried newer versions of the agent's packages than the ones tested, one of which no longer fit, so every message ended with "ACP connection closed". The installer now carries exactly the versions in the lockfile, and its build stops if any differ.
