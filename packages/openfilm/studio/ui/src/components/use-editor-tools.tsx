/**
 * The editor's audio and timeline tools, gathered for the project's page (ProjectView): markers (lib/markers), solo
 * (lib/solo), track heights (lib/track-heights), loudness normalization (lib/loudness), freeze frame
 * (lib/freeze-frame) and replacing a clip (lib/clip-replace). What the timeline draws and its menus offer come from
 * here; the edits go through the page's own edit, one write and one undo step each.
 */
import * as React from 'react';
import { AudioLines, HardDriveUpload, Replace, Snowflake } from 'lucide-react';

import { api, type Clip, type Film, type Op, type ProjectSettings } from '@/api';
import { useT } from '@/i18n';
import { canReplace, familyOfClip, replaceClip, type ReplaceFamily, type ReplaceFile } from '@/lib/clip-replace';
import { freezeSourceMs, planFreeze } from '@/lib/freeze-frame';
import { LOUDNESS_TARGETS, measuredSpan, normalizeVolume } from '@/lib/loudness';
import {
  addMarker, changeMarker, markerClip, nextMarker, parseMarkers, placeMarkers, removeMarker, type Marker, type PlacedMarker,
} from '@/lib/markers';
import type { ClipEdit } from '@/lib/film-clip-edits';
import { heardClips, toggleSolo } from '@/lib/solo';
import type { EditModel } from '@/lib/timeline-edit';
import { readTimelinePrefs, switchesOf } from '@/lib/timeline-prefs';
import type { KeyCommand } from '@/lib/timeline-keys';
import type { TimelineBlock, TimelineTrack } from '@/lib/timeline-layout';
import type { MediaListing } from '@/lib/workspace-resources';
import { ownTrackHeight, sizeOf, trackHeightsOf, withTrackHeight, TRACK_SIZES, type TrackSize } from '@/lib/track-heights';
import type { Player } from '@/editor/player';
import type { OutsideStep } from '@/editor/use-film';
import type { ContextMenuEntry } from './ContextMenu';
import type { MarkerLaneView } from './Timeline';
import { ClipMarkers, LaneMarkers, MarkerGlyph, type MarkerActions } from './TimelineMarkers';

type Toast = { show: (text: string) => void; showError: (text: string) => void };

/** A file brought in to replace a clip: how long its length is waited for, and how long the file itself. */
const REPLACE_PROBE_MS = 8000;
const REPLACE_GIVE_UP_MS = 30_000;


/** Whether a clip on the timeline is heard: a sound, or a video with a sound of its own that is not turned off. */
const sounding = (b: TimelineBlock) => Boolean(b.clipId && b.loc && b.src) && (
  b.kind === 'voice' || b.kind === 'sfx' || b.kind === 'music' || (b.kind === 'video' && b.ownAudio && !b.silent)
) && b.volume !== 0;

export function useEditorTools({
  projectId, tracks, film, settings, patchSettings, player, timeRef, seek, edit, record, editModel, selectedClipIds, listing, toast, pickFile,
}: {
  projectId: string;
  tracks: readonly TimelineTrack[];
  film: Film | null;
  settings: ProjectSettings | null;
  patchSettings: (patch: Parameters<typeof api.patchSettings>[1]) => void;
  player: React.MutableRefObject<Player>;
  /** where the playhead is, ms */
  timeRef: React.MutableRefObject<number>;
  seek: (ms: number) => void;
  edit: (ops: Op[], label: string) => Promise<string | null>;
  /** Keeps an edit of another file (the markers) as a step of the film's history, so ⌘Z undoes it in turn. */
  record: (label: string, outside: OutsideStep) => void;
  editModel: () => EditModel;
  selectedClipIds: readonly string[];
  /** the project's media and pages, with their lengths as probed */
  listing: MediaListing | null;
  toast: Toast;
  /**
   * A file from this computer, to replace a clip with: the person picks it, it is brought into the project, and its
   * path there comes back (null: cancelled). Missing: the replace menu has only the project's files.
   */
  pickFile?: (family: ReplaceFamily) => Promise<string | null>;
}) {
  const t = useT();
  /* what can take a clip's place: the media and the pages */
  const media = React.useMemo<readonly (ReplaceFile & { name: string })[]>(
    () => [...(listing?.files ?? []).filter((f) => f.kind !== 'other'), ...(listing?.pages ?? [])],
    [listing],
  );
  const tracksRef = React.useRef(tracks);
  tracksRef.current = tracks;
  const filmRef = React.useRef(film);
  filmRef.current = film;

  /* ── markers: read once per project, written whole on each change (one at a time, in order), each change a step
     of the history (⌘Z puts the list back as it was) ── */
  const [markers, setMarkers] = React.useState<Marker[]>([]);
  const markersRef = React.useRef(markers);
  markersRef.current = markers;
  const writes = React.useRef<Promise<unknown>>(Promise.resolve());
  React.useEffect(() => {
    let live = true;
    setMarkers([]);
    void api.markers(projectId).then((raw) => { if (live) setMarkers(parseMarkers(raw)); }, () => {});
    return () => { live = false; };
  }, [projectId]);
  const writeMarkers = React.useCallback((next: Marker[]): Promise<string | null> => {
    setMarkers(next);
    markersRef.current = next;
    const done = writes.current.then(() => api.putMarkers(projectId, next)).then(() => null, (e: Error) => e.message);
    writes.current = done;
    return done;
  }, [projectId]);
  const saveMarkers = React.useCallback((next: Marker[]) => {
    const was = markersRef.current;
    void writeMarkers(next).then((err) => { if (err) toast.showError(err); });
    record('history.stepMarker', { undo: () => writeMarkers(was), redo: () => writeMarkers(next) });
  }, [writeMarkers, record, toast]);
  const placed = React.useMemo(() => placeMarkers(markers, tracks), [markers, tracks]);
  const [naming, setNaming] = React.useState<string | null>(null);
  const onNamed = React.useCallback(() => setNaming(null), []);
  const placedRef = React.useRef(placed);
  placedRef.current = placed;
  const snapPointsMs = React.useMemo(() => placed.map((p) => p.ms), [placed]);

  /* `atMs`: where (the playhead when not said) */
  const addMarkerHere = React.useCallback((on?: TimelineBlock | null, at?: number) => {
    const atMs = at ?? timeRef.current;
    const clip = on === undefined ? markerClip(tracksRef.current, selectedClipIds, atMs) : on;
    const { list, added } = addMarker(markersRef.current, atMs, clip);
    /* one there already: M again names it */
    if (list.length === markersRef.current.length) { setNaming(added.id); return; }
    saveMarkers(list);
    if (added.clip && clip) toast.show(t('editorTools.markerAddedOn').replace('{clip}', clip.title));
  }, [selectedClipIds, saveMarkers, timeRef, toast, t]);
  const goMarker = React.useCallback((dir: 1 | -1) => {
    const to = nextMarker(placedRef.current, timeRef.current, dir);
    if (to) seek(to.ms);
  }, [seek, timeRef]);
  const markerActions = React.useMemo<MarkerActions>(() => ({
    onSeek: (ms) => seek(ms),
    onChange: (id, change) => {
      const m = markersRef.current.find((x) => x.id === id);
      /* a clip marker moved is moved within its clip's file */
      if (m?.clip && change.t !== undefined) {
        const p = placedRef.current.find((x) => x.marker.id === id);
        if (p?.clip) change = { ...change, t: m.t + ((change.t * 1000 - p.ms) * (p.clip.speed ?? 1)) / 1000 };
      }
      saveMarkers(changeMarker(markersRef.current, id, change));
    },
    onRemove: (id) => saveMarkers(removeMarker(markersRef.current, id)),
    naming,
    onNamed,
  }), [seek, saveMarkers, naming, onNamed]);

  /** The editor's keys for markers (lib/timeline-keys): true when it was one. */
  const onKey = React.useCallback((cmd: KeyCommand): boolean => {
    if (cmd === 'add-marker') { addMarkerHere(); return true; }
    if (cmd === 'next-marker' || cmd === 'prev-marker') { goMarker(cmd === 'next-marker' ? 1 : -1); return true; }
    return false;
  }, [addMarkerHere, goMarker]);

  /* ── solo: Studio's playback only ── */
  const [solo, setSolo] = React.useState<ReadonlySet<number>>(new Set());
  React.useEffect(() => { setSolo(new Set()); }, [projectId]);
  const heard = React.useMemo(() => heardClips(film?.tracks ?? [], solo), [film, solo]);
  React.useEffect(() => { player.current.setHeard(heard); }, [player, heard]);
  const soloProp = React.useMemo(() => ({
    tracks: solo,
    onToggle: (docIndex: number, only: boolean) => setSolo((now) => toggleSolo(now, docIndex, only)),
  }), [solo]);

  /* ── track heights: kept in the project's settings; while an edge is dragged, the height in hand ── */
  const [live, setLive] = React.useState<{ docIndex: number; height: number } | null>(null);
  React.useEffect(() => { setLive(null); }, [settings]);
  const heights = React.useMemo(() => trackHeightsOf(settings?.trackHeights ?? [], film?.tracks ?? []), [settings, film]);
  const shownTracks = React.useMemo(() => tracks.map((tr) => {
    const h = tr.docIndex == null ? undefined : live?.docIndex === tr.docIndex ? live.height : heights.get(tr.docIndex);
    return h == null ? tr : { ...tr, height: h };
  }), [tracks, heights, live]);
  const setHeights = React.useCallback((indexes: readonly number[], height: number | null) => {
    patchSettings({ trackHeights: withTrackHeight(settings?.trackHeights ?? [], filmRef.current?.tracks ?? [], indexes, height) });
  }, [settings, patchSettings]);
  const onResizeTrack = React.useCallback((track: TimelineTrack, height: number | null, done: boolean) => {
    if (track.docIndex == null) return;
    if (!done && height != null) { setLive({ docIndex: track.docIndex, height }); return; }
    /* back to its own height, or the one dragged to (the timeline's own one is not kept) */
    setHeights([track.docIndex], height == null || height === ownTrackHeight(track) ? null : height);
  }, [setHeights]);
  const headMenuExtra = React.useCallback((track: TimelineTrack): ContextMenuEntry[] => {
    const docIndex = track.docIndex;
    if (docIndex == null) return [];
    const now = heights.get(docIndex) ?? ownTrackHeight(track);
    const size = sizeOf(now, track.kind);
    const sizes = (Object.keys(TRACK_SIZES) as TrackSize[]);
    const all = filmRef.current?.tracks.map((_, i) => i) ?? [];
    const heightFor = (s: TrackSize, kind: 'visual' | 'audio') => (s === 'medium' ? null : TRACK_SIZES[s][kind]);
    return [
      {
        id: 'track-height',
        label: t('editorTools.trackHeight'),
        submenu: sizes.map((s) => ({
          id: `height:${s}`, label: t(`editorTools.size.${s}`), checked: size === s,
          onSelect: () => setHeights([docIndex], heightFor(s, track.kind)),
        })),
      },
      {
        id: 'tracks-height',
        label: t('editorTools.allTracksHeight'),
        submenu: sizes.map((s) => ({
          id: `heights:${s}`, label: t(`editorTools.size.${s}`),
          onSelect: () => {
            /* each track its kind's size of it; medium is the timeline's own, nothing to keep */
            if (s === 'medium') { patchSettings({ trackHeights: null }); return; }
            const rows = tracksRef.current;
            const kindOf = (i: number) => rows.find((r) => r.docIndex === i)?.kind ?? 'visual';
            let saved: NonNullable<ProjectSettings['trackHeights']> = [];
            for (const kind of ['visual', 'audio'] as const) {
              saved = withTrackHeight(saved, filmRef.current?.tracks ?? [], all.filter((i) => kindOf(i) === kind), TRACK_SIZES[s][kind]);
            }
            patchSettings({ trackHeights: saved });
          },
        })),
      },
    ];
  }, [heights, setHeights, patchSettings, t]);

  /* ── loudness ── */
  const [measuring, setMeasuring] = React.useState(false);
  const normalize = React.useCallback(async (blocks: readonly TimelineBlock[], target: number) => {
    const heardBlocks = blocks.filter(sounding);
    if (!heardBlocks.length) { toast.show(t('editorTools.normalizeNone')); return; }
    if (heardBlocks.some((b) => tracksRef.current.some((tr) => tr.locked && tr.blocks.some((x) => x.id === b.id)))) { toast.show(t('timeline.trackLocked')); return; }
    setMeasuring(true);
    toast.show(t('editorTools.normalizing'));
    try {
      const measured = await Promise.all(heardBlocks.map(async (b) => {
        const { from, to } = measuredSpan(b);
        try { return { b, lufs: (await api.loudness(projectId, b.src!, from, to)).lufs, error: null as string | null }; }
        catch (e) { return { b, lufs: null, error: (e as Error).message }; }
      }));
      const edits: ClipEdit[] = [];
      const notes: string[] = [];
      for (const { b, lufs, error } of measured) {
        if (error) { notes.push(t('editorTools.normalizeFail').replace('{clip}', b.title).replace('{reason}', error)); continue; }
        const plan = normalizeVolume(lufs, target);
        if ('silent' in plan) { notes.push(t('editorTools.normalizeSilent').replace('{clip}', b.title)); continue; }
        edits.push({ loc: b.loc!, prop: 'volume', value: plan.volume === 1 ? null : plan.volume });
        if (!plan.reached) notes.push(t('editorTools.normalizeShort').replace('{clip}', b.title).replace('{target}', String(target)).replace('{lufs}', String(plan.lufs)));
        else if (heardBlocks.length === 1) notes.push(t('editorTools.normalizedOne').replace('{clip}', b.title).replace('{from}', String(lufs)).replace('{target}', String(target)).replace('{pct}', String(Math.round(plan.volume * 100))));
      }
      if (edits.length) {
        const ops: Op[] = [{ op: 'props', edits: edits.map((e) => ({ clip: heardBlocks.find((b) => b.loc === e.loc)!.clipId!, prop: 'volume', value: e.value as number | null })) }];
        const failed = await edit(ops, `history.stepNormalized|${target}`);
        if (failed) { toast.showError(failed); return; }
      }
      const done = edits.length > 1 ? [t('editorTools.normalized').replace('{n}', String(edits.length)).replace('{target}', String(target))] : [];
      if (done.length || notes.length) toast.show([...done, ...notes].join(' · '));
    } finally {
      setMeasuring(false);
    }
  }, [projectId, edit, toast, t]);

  /* ── freeze frame ── */
  const freeze = React.useCallback(async (block: TimelineBlock) => {
    const at = timeRef.current;
    const srcMs = freezeSourceMs(block, at);
    const ti = filmRef.current?.tracks.findIndex((tr) => tr.clips.some((c) => c.id === block.clipId)) ?? -1;
    const clip = ti >= 0 ? filmRef.current!.tracks[ti]!.clips.find((c) => c.id === block.clipId) : undefined;
    if (srcMs == null || !clip || !block.src) { toast.show(t('editorTools.freezeOutside')); return; }
    if (filmRef.current!.tracks[ti]!.locked) { toast.show(t('timeline.trackLocked')); return; }
    let still: string;
    try { still = await api.freezeFrame(projectId, block.src, srcMs); }
    catch (e) { toast.showError(t('editorTools.freezeFail').replace('{reason}', (e as Error).message)); return; }
    /* the still goes in between at the playhead: what follows on that track moves on (with linkage, what
       rides on the main track along) */
    const ops = planFreeze(editModel(), { clip, track: ti, atMs: at, still, mode: 'insert', ...switchesOf(readTimelinePrefs()) });
    if (!ops) { toast.show(t('timeline.trackLocked')); return; }
    const failed = await edit(ops, `history.stepFroze|${clip.id}`);
    if (failed) toast.showError(failed);
  }, [projectId, edit, editModel, timeRef, toast, t]);

  /* ── replace ── */
  const replace = React.useCallback(async (block: TimelineBlock, file: ReplaceFile) => {
    const clip: Clip | undefined = filmRef.current?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === block.clipId);
    if (!clip) return;
    if (tracksRef.current.some((tr) => tr.locked && tr.blocks.some((x) => x.id === block.id))) { toast.show(t('timeline.trackLocked')); return; }
    const plan = replaceClip(clip, block.endMs - block.startMs, file);
    if ('error' in plan) { if (plan.error === 'kind') toast.show(t('editorTools.replaceKind')); return; }
    const failed = await edit([{ op: 'props', edits: plan.edits.map((e) => ({ clip: clip.id, ...e })) }], `history.stepReplaced|${clip.id}`);
    if (failed) { toast.showError(failed); return; }
    if (plan.shortMs > 0) toast.show(t('editorTools.replaceShort').replace('{s}', (plan.shortMs / 1000).toFixed(2)));
  }, [edit, toast, t]);
  const onReplaceDrop = React.useCallback((block: TimelineBlock, file: ReplaceFile) => { void replace(block, file); }, [replace]);

  /* a file from this computer: brought in first, then put in the clip's place once the listing has it with its length
     (probed after it lands); a file whose length never comes is used as it is after a while */
  const pendingReplace = React.useRef<{ block: TimelineBlock; path: string; since: number } | null>(null);
  const [replaceWait, setReplaceWait] = React.useState(0);
  const tryPendingReplace = React.useCallback(() => {
    const wait = pendingReplace.current;
    if (!wait) return;
    const file = media.find((f) => f.path === wait.path);
    const late = Date.now() - wait.since > REPLACE_PROBE_MS;
    if (!file) {
      if (Date.now() - wait.since > REPLACE_GIVE_UP_MS) { pendingReplace.current = null; toast.showError(t('assets.uploadFailed')); }
      return;
    }
    const timed = file.kind === 'video' || file.kind === 'audio';
    if (timed && !(file.durationMs && file.durationMs > 0) && !late) return;
    pendingReplace.current = null;
    void replace(wait.block, file);
  }, [media, replace, toast, t]);
  React.useEffect(() => { tryPendingReplace(); }, [tryPendingReplace, replaceWait]);
  React.useEffect(() => {
    if (!replaceWait) return undefined;
    const timer = window.setInterval(() => { if (pendingReplace.current) tryPendingReplace(); else window.clearInterval(timer); }, 500);
    return () => window.clearInterval(timer);
  }, [replaceWait, tryPendingReplace]);
  const replaceFromComputer = React.useCallback(async (block: TimelineBlock) => {
    const clip: Clip | undefined = filmRef.current?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === block.clipId);
    if (!clip || !pickFile) return;
    let path: string | null;
    try { path = await pickFile(familyOfClip(clip)); } catch (e) { toast.showError(e instanceof Error && e.message ? e.message : t('assets.uploadFailed')); return; }
    if (!path) return;
    pendingReplace.current = { block, path, since: Date.now() };
    setReplaceWait((n) => n + 1);
  }, [pickFile, toast, t]);

  /** What can take a clip's place: the project's files that fit, then one from this computer. */
  const replaceEntries = React.useCallback((block: TimelineBlock): ContextMenuEntry[] => {
    const clip = block.clipId ? filmRef.current?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === block.clipId) : undefined;
    if (!clip) return [];
    const fits = media.filter((f) => canReplace(clip, f));
    return [
      ...fits.slice(0, 20).map((f) => ({ id: `replace:${f.path}`, label: f.name, onSelect: () => { void replace(block, f); } })),
      ...(pickFile ? [
        ...(fits.length ? [{ id: 'replace-sep', separator: true as const }] : []),
        { id: 'replace-computer', label: t('editorTools.replaceFromComputer'), icon: <HardDriveUpload size={14} />, onSelect: () => { void replaceFromComputer(block); } },
      ] : []),
    ];
  }, [media, replace, replaceFromComputer, pickFile, t]);

  /** What the tools add to a clip's menu. */
  const menuExtra = React.useCallback((blocks: readonly TimelineBlock[]): ContextMenuEntry[] => {
    const out: ContextMenuEntry[] = [];
    const one = blocks.length === 1 ? blocks[0]! : null;
    const atMs = timeRef.current;
    const anySound = blocks.some(sounding);
    out.push({
      id: 'normalize',
      label: t('editorTools.normalize'),
      icon: <AudioLines size={14} />,
      disabled: !anySound || measuring,
      hint: t('editorTools.normalizeNone'),
      submenu: LOUDNESS_TARGETS.map((target) => ({
        id: `normalize:${target.id}`,
        label: t(`editorTools.target.${target.id}`).replace('{lufs}', String(target.lufs)),
        onSelect: () => { void normalize(blocks, target.lufs); },
      })),
    });
    if (one?.kind === 'video' && one.clipId && one.src && !/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(one.src)) {
      const inside = freezeSourceMs(one, atMs) != null;
      out.push({ id: 'freeze', label: t('editorTools.freeze'), icon: <Snowflake size={14} />, disabled: !inside, hint: t('editorTools.freezeOutside'), onSelect: () => { void freeze(one); } });
    }
    if (one?.clipId) {
      const choices = replaceEntries(one);
      out.push({
        id: 'replace',
        label: t('editorTools.replace'),
        icon: <Replace size={14} />,
        disabled: !choices.length,
        hint: t('editorTools.replaceNone'),
        submenu: choices,
      });
      const on = atMs >= one.startMs && atMs < one.endMs;
      out.push({ id: 'clip-marker', label: t('editorTools.markerAddClip'), icon: <MarkerGlyph size={14} />, shortcut: 'M', disabled: !on, hint: t('editorTools.freezeOutside'), onSelect: () => addMarkerHere(one) });
    }
    return out;
  }, [measuring, media, normalize, freeze, replaceEntries, addMarkerHere, timeRef, t]);

  /* ── what the timeline draws ── */
  const clipMarkersByTrack = React.useMemo(() => {
    const by = new Map<string, PlacedMarker[]>();
    for (const p of placed) {
      if (!p.clip) continue;
      const lane = tracks.find((tr) => tr.blocks.some((b) => b.id === p.clip!.id))?.lane;
      if (lane) by.set(lane, [...(by.get(lane) ?? []), p]);
    }
    return by;
  }, [placed, tracks]);
  const markerLane = React.useMemo(() => ({
    shown: placed.some((p) => !p.clip),
    render: (lane: MarkerLaneView) => <LaneMarkers placed={placed} lane={lane} actions={markerActions} />,
  }), [placed, markerActions]);
  const onAddMarker = React.useCallback(() => addMarkerHere(), [addMarkerHere]);
  /* the ruler's own menu: a marker there (on the film), as M puts one at the playhead */
  const rulerMenu = React.useCallback((atMs: number): ContextMenuEntry[] => [
    { id: 'add-marker', label: t('editorTools.markerAdd'), icon: <MarkerGlyph size={14} />, shortcut: 'M', onSelect: () => addMarkerHere(null, atMs) },
  ], [addMarkerHere, t]);
  const trackOverlay = React.useCallback((track: TimelineTrack, pxPerMs: number) => {
    const here = clipMarkersByTrack.get(track.lane);
    return here ? <ClipMarkers placed={here} pxPerMs={pxPerMs} height={track.height ?? ownTrackHeight(track)} actions={markerActions} /> : null;
  }, [clipMarkersByTrack, markerActions]);

  /** the mix's level now, for the meters */
  const levels = React.useCallback(() => player.current.levels(), [player]);

  return {
    /** the timeline's tracks with the heights they are drawn at */
    tracks: shownTracks,
    timeline: { solo: soloProp, markerLane, onAddMarker, rulerMenu, trackOverlay, snapPointsMs, onResizeTrack, onReplaceDrop },
    menuExtra,
    /** what can replace a clip (the inspector's Replace) */
    replaceEntries,
    headMenuExtra,
    onKey,
    levels,
  };
}
