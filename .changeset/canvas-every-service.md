---
"openfilm": minor
---

The canvas works with every service. A making node's model list shows each service's models, the person's own first and the others a click from connecting, each with what it makes (lengths, how many pictures it takes, whether it starts from a first frame). The node then offers only what its model makes: its shapes, lengths and qualities, and references or first and last frames when it takes both. Pictures wired into a picture node are its references, so a character made once stays the same in every shot.

A service that is not built in can be added as a provider of one's own: a `provider.mjs` in the shared home's `providers/<id>/` folder, following the built-in providers' contract, read again when it changes. It shows in Settings, on the canvas and in `openfilm get`, and agents are told where and how to write one from a service's API docs.

An empty canvas starts from four ways of working, each saying what it gets: picture to clip, a character (portrait and turnaround), a three-shot storyboard, and a short episode (a character, three shots made with them, their clips cut onto the timeline). Templates leave the words to write, each note saying what to write for what it feeds, and open the first one to type in. A node will not run with an empty note or an unmade node wired in, and a run the service's balance could not pay says so plainly.
