# Audio cut smoothing

Studio has two controls for short audio fades:

- Select adjoining audio clips and use **Smooth audio cuts** in their context menu for a one-time edit.
- Use **Automatic audio smoothing** in the timeline toolbar to enable 5, 10 or 20 ms ramps for future edits in this project. Off is the default. 10 ms is a starting point for abrupt cut edges, not a rule for musical phrasing.

The automatic policy is saved as `audioSmoothingMs` in `.film/settings.json`. It survives a reload or an agent rewriting `film.html`; other projects keep their own choice. Changing the policy does not rewrite the film or remove existing fades. An unreadable settings file or invalid audio policy is reported as an error instead of silently disabling enforcement.

## What is automatic

Every managed edit passes through `editProjectFilm` on the Studio server. After the requested operations, it compares the before and after audio seams. At a new or changed eligible seam it adds a short fade-out on the outgoing clip and fade-in on the incoming clip, preserving existing fades. The edit and its fades are validated and written together.

This applies to any edit API caller, including an agent that never mentions smoothing. It does not depend on a prompt or a particular toolbar action. Deleting a section and closing its gap, moving clips together or changing a source trim can create a new seam. Cutting one continuous source into two without removing material does not need a ramp.

The server returns the effective operations and the actual before value when it adds fades. Studio uses those to record the inverse of the complete edit. Undo restores the cut and its fades together. Undo/redo is exact replay, so removing a fade is not immediately counteracted by automatic smoothing. Managed writes to one project are serialized.

## Eligibility and exceptions

- Both clips must be audio-only, on the same unlocked, visible, unmuted track, with nonzero volume and explicit finite source in/out points.
- The edges must touch within the format's millisecond rounding tolerance. Gaps and overlapping cuts are not crossfaded or repositioned.
- The same source at consecutive source times, with the same speed and volume, is continuous and skipped.
- Existing fades and direct manual edits to fade properties are preserved. Very short clips share the available duration between new ramps.
- Add `data-audio-smoothing="off"` to an audio clip to opt it out, for example for an intentional impact. Either clip opting out excludes their shared seam.
- Embedded video audio is left alone: detach it first so that an audio fade does not also fade the picture. Unknown source ends are left alone rather than guessed.

This is a deterministic envelope rule, not waveform or speech analysis. It cannot restore a clipped syllable, match ambience, remove noise or decide whether a transient is artistically intentional. The 5–20 ms presets are not the longer fades used to start or end a music bed.

## Agents and outside file writes

An agent can enable the policy through the authenticated Studio API:

```text
PATCH /api/projects/:id/settings
{ "audioSmoothingMs": 10 }
```

It should then use the normal edit endpoint. Smoothing is applied by default, without a special operation:

```text
POST /api/projects/:id/edit
{ "base": "the current revision", "ops": [ ... ] }
```

`replay: true` is reserved for exact undo/redo, not new edits.

An agent or text editor can also write `film.html` directly, bypassing Studio's edit API. Studio does not silently overwrite those writes. Once its file watcher settles, the editor reloads the film and checks eligible seams. The project GET response includes `audioSmoothing: { ms, pending }`, where `pending` counts clips with missing eligible ramps. The toolbar shows **Repair N audio clips** while any remain. Existing cuts can also appear here when the policy is first enabled or a repair is undone.

Repair is an explicit undoable action against the checked revision:

```text
POST /api/projects/:id/edit
{ "base": "the checked revision", "ops": [], "repairAudio": true }
```

A stale repair is refused with a conflict instead of deliberately replacing a newer file. Studio also rechecks the revision before writing a managed edit. This is not an operating-system transaction with arbitrary external writers: another program can still write between the final check and rename. External writes made while Studio is closed, CLI renders and other applications are outside this enforcement boundary. For automatic processing, agents must use Studio's edit API. No prompt can remove that boundary.
