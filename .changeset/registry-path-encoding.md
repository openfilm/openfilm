---
"@openfilm/desktop": patch
---

Windows: folders with Chinese (or other non-English) names on the PATH, and the other variables Windows keeps for the person, reach the agents as they are. On a Chinese Windows they came out garbled (`E:\软件安装` read as `E:\������װ`), so an agent installed into such a folder while the app ran was not found, and "Why isn't it found?" listed the garbled folder.
