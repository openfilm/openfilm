---
"openfilm": minor
---

The library's Skills and Plugins tabs are one tab, Plugins, where Skills was. It lists OpenFilm's own plugins, the skills installed, the plugins people made and each agent's own skills together, with Installed, Favorites and Discover down the side, and chips across the top to show only workbenches, skills or connections. Each line shows what it brings (a workbench, a skill, commands, a tab of the library) beside its switch. A plugin's page and a skill's page say how to use it, what it brings and what it may do on this computer. Turning on a plugin with a workbench says where it now is, with Open to show it. A library arranged in Settings › Advanced keeps its order, with Plugins where Skills was.

A plugin can now be a tab of the library instead of a workbench: its `openfilm.json` says `"tab": { "icon": …, "title": {…} }`, and its element (or page) is shown in that tab, after the library's own, while the plugin is on. These tabs are arranged with the others in Settings › Advanced.
