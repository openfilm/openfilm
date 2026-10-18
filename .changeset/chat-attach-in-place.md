---
"@openfilm/desktop": patch
"openfilm": patch
---

The chat takes any number of files in one message, and folders too. A file or folder dragged in from your disk stays where it is: the message gives the agent its path, and the agent copies into the project only what the film uses, so Studio's media no longer fills up with everything you dropped. A file pasted from the clipboard, which has no path of its own, is kept in the project's `.film/attachments/`. Up to 20 pictures go to the agent with a message, the pictures of what you pointed at in Studio first; the rest go by their path.
