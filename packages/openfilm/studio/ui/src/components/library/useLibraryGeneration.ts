import React from 'react';
import { api, type Op } from '@/api';
import { useT } from '@/i18n';
import { assetDropInsert, type PendingDrop, type StageSize } from '@/lib/asset-timeline';
import {
  GENERATION_VERBS, generationDesign, generationFile, generationPlaceholder, generationPrompt, generationSlot,
  type GenerationActions, type GenerationInput, type GenerationSlot, type GenerationStatus,
} from '@/lib/asset-generation';
import { receiptOf } from '@/lib/canvas';
import { studioHost } from '@/lib/host';
import { BUILT_IN, builtInItem } from '@/lib/library';
import type { ResourceDragItem } from '@/lib/resource-drag';
import { snapToFrame } from '@/lib/timecode';
import type { TimelineBlock, TimelineTrack } from '@/lib/timeline-layout';
import type { PictureCut, TransitionAsk } from '@/lib/transitions';

type Result =
  | { type: 'clip'; file: ResourceDragItem; seconds: number; style?: string }
  | { type: 'cut'; request: TransitionAsk }
  | { type: 'caption'; path: string };

type Job = {
  id: string;
  input: GenerationInput;
  placeholder: ResourceDragItem;
  slot: GenerationSlot;
  cut: PictureCut | null;
  cutNames: string;
  speech: TimelineBlock | null;
  result?: Result;
  error?: string;
};

interface Options {
  projectId: string;
  folder: string | undefined;
  tracks: () => readonly TimelineTrack[];
  target: () => number | null;
  time: () => number;
  cut: () => PictureCut | null;
  canCut: (cut: PictureCut) => boolean;
  speech: () => TimelineBlock | null;
  stage: () => StageSize | null;
  pending: (slot: PendingDrop | null) => void;
  edit: (ops: Op[], label: string) => Promise<string | null>;
  transition: (ask: TransitionAsk) => Promise<string | null>;
  done: (name: string) => void;
}

export function useLibraryGeneration(options: Options): GenerationActions {
  const t = useT();
  const context = React.useRef(options);
  context.current = options;
  const current = React.useRef<Job | null>(null);
  const [status, setStatus] = React.useState<GenerationStatus | null>(null);

  function show(job: Job | null) {
    current.current = job;
    context.current.pending(job ? generationPlaceholder(job.placeholder, job.id, job.slot, Boolean(job.error)) : null);
    setStatus(job ? { kind: job.input.kind, label: job.placeholder.name, error: job.error, canRetryPlacement: Boolean(job.result) } : null);
  }

  async function make(job: Job, settings: Options): Promise<Result> {
    const { input, speech, cut } = job;
    const { projectId, folder } = settings;
    const verb = GENERATION_VERBS[input.kind];
    if (verb && input.model && folder) {
      const { via, model } = input.model;
      const pick = { via, ...(model ? { model } : {}), yes: true };
      if (verb === 'asr') {
        if (!speech?.src || !speech.clipId) throw new Error(t('assetGeneration.speechHint'));
        const path = speech.src.split('#')[0]!;
        await api.make(folder, verb, { src: path }, pick);
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/from-subtitles`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: job.id, clips: [speech.clipId] }),
        });
        const body = await res.json() as { src?: string; text?: string; error?: string };
        if (!res.ok || !body.src || !body.text?.includes('-->')) throw new Error(body.error ?? t('timeline.captionsNone'));
        return { type: 'caption', path: body.src };
      }
      const args: Record<string, unknown> = { out: job.id };
      if (verb === 'tts') { args.text = input.prompt; args.voice = input.voice; }
      else args.prompt = input.prompt;
      if (verb === 'image') {
        if (input.ratio) args.ratio = input.ratio;
        if (input.kind === 'sticker') args.transparent = true;
      }
      if (verb === 'video') {
        args.duration = String(Math.round(input.seconds));
        if (input.ratio) args['aspect-ratio'] = input.ratio;
      }
      if (verb === 'music' || verb === 'sfx') args.sec = String(input.seconds);
      const receipt = receiptOf<{ src?: string; dur?: number; w?: number; h?: number }>(await api.make(folder, verb, args, pick));
      if (!receipt.src) throw new Error(t('assetGeneration.missingResult'));
      const actual = typeof receipt.dur === 'number' && receipt.dur > 0 ? receipt.dur : input.seconds;
      const length = verb === 'tts' ? actual : Math.min(input.seconds, actual);
      const file = {
        ...job.placeholder, path: receipt.src, durationMs: Math.round(length * 1000),
        ...(receipt.w && receipt.h ? { w: receipt.w, h: receipt.h } : {}),
      };
      return { type: 'clip', file, seconds: length };
    }

    if (!input.writing || verb) throw new Error(t('assetGeneration.connectModel'));
    const direction = cut ? `${input.prompt}\n\nShots at the cut: ${job.cutNames}` : input.prompt;
    const { text } = await api.canvasWrite(projectId, generationPrompt(input.kind, direction), [], input.writing);
    const design = generationDesign(input.kind, text, input.seconds);
    if (design.kind === 'transition') {
      if (!cut) throw new Error(t('assetDrawer.noCut'));
      const { style, seconds } = design;
      const durationMs = Math.round(seconds * 1000);
      if (style === 'dissolve' || style === 'dip-black' || style === 'dip-white') {
        return { type: 'cut', request: { kind: 'add', type: style, cut, durationMs } };
      }
      const motion = builtInItem(`${BUILT_IN}/motions/move-${style}`)?.motion;
      if (!motion?.in) throw new Error(t('assetGeneration.missingResult'));
      const move = { in: motion.in, ...(motion.out ? { out: motion.out } : {}) };
      return { type: 'cut', request: { kind: 'add', type: 'move', cut, move, durationMs } };
    }
    const html = design.kind === 'page' ? design.html
      : `<!doctype html><meta charset="utf-8"><script>window.film={duration:${input.seconds},frame(){}}</script>`;
    await api.writePage(projectId, job.placeholder.path, html, null);
    if (input.kind === 'template') {
      const { folder } = await api.writePartFilm(projectId, job.id, {
        stage: settings.stage() ?? { w: 1920, h: 1080 },
        tracks: [{ clips: [{ id: 'title-card', src: `../../${job.placeholder.path}`, time: [0, input.seconds] }] }],
      });
      return { type: 'clip', file: { ...job.placeholder, path: `${folder}/film.html` }, seconds: input.seconds };
    }
    return {
      type: 'clip', file: job.placeholder, seconds: input.seconds,
      ...(design.kind === 'filter' ? { style: `backdrop-filter: ${design.css}` } : {}),
    };
  }

  async function place(job: Job, result: Result, settings: Options) {
    if (result.type === 'cut') {
      if (!job.cut || !settings.canCut(job.cut)) throw new Error(t('assetDrawer.noCut'));
      const why = await settings.transition(result.request);
      if (why) throw new Error(why);
      return;
    }
    if (result.type === 'caption') {
      const row = settings.tracks().find((row) => row.blocks.some((b) => b.clipId === job.speech?.clipId));
      if (!row || row.locked) throw new Error(t('assetGeneration.slotChanged'));
      const why = await settings.edit([{ op: 'captions', at: row.docIndex ?? 0, captions: { src: result.path, label: t('assetGeneration.captionTrack') } }], 'captionTrack.stepAuto');
      if (why) throw new Error(why);
      return;
    }
    const { slot } = job;
    const tracks = settings.tracks().filter((tr) => tr.docIndex != null);
    const anchor = slot.anchors.length
      ? tracks.find((tr) => tr.blocks.some((b) => b.clipId && slot.anchors.includes(b.clipId)))
      : null;
    const count = tracks.reduce((end, row) => Math.max(end, row.docIndex! + 1), 0);
    const target = { ...slot.target };
    if (slot.anchors.length && !anchor || !slot.anchors.length && count !== slot.count || anchor?.locked) throw new Error(t('assetGeneration.slotChanged'));
    if (target.lane) {
      if (anchor) target.lane = anchor.lane;
      const row = tracks.find((r) => r.lane === target.lane);
      if (!row || row.locked || row.hidden || tracks.some((tr) => tr.docIndex === row.docIndex && tr.blocks.some((b) =>
        b.clipId && b.startMs < slot.atMs + result.seconds * 1000 - 0.5 && b.endMs > slot.atMs + 0.5))) {
        throw new Error(t('assetGeneration.slotChanged'));
      }
    } else if (anchor?.docIndex != null && target.insertTrackAt != null) {
      target.insertTrackAt = anchor.docIndex + (job.placeholder.kind === 'audio' ? 1 : 0);
    }
    const plan = assetDropInsert(result.file, tracks, target, slot.atMs, settings.stage());
    if ('error' in plan) throw new Error(t('assetGeneration.slotChanged'));
    const why = await settings.edit([{
      op: 'insert', clip: { ...plan.element, src: result.file.path, time: [0, result.seconds], ...(result.style ? { style: result.style } : {}) },
      at: plan.at, ...(plan.track != null ? { track: plan.track } : {}),
    }], 'history.stepDrop');
    if (why) throw new Error(why);
  }

  async function run(job: Job) {
    show(job);
    studioHost?.tabs?.report({ generating: true });
    try {
      job.result ??= await make(job, context.current);
      await place(job, job.result, context.current);
      show(null);
      context.current.done(job.placeholder.name);
    } catch (error) {
      show({ ...job, error: error instanceof Error && error.message ? error.message : t('timeline.editFail') });
    } finally {
      studioHost?.tabs?.report({ generating: false });
    }
  }

  function start(input: GenerationInput) {
    if (current.current && !current.current.error) return;
    const settings = context.current;
    const tracks = settings.tracks();
    const target = settings.target();
    const anchor = target == null ? null : tracks.find((tr) => tr.docIndex === target);
    const cut = input.kind === 'transition' ? settings.cut() : null;
    const speech = input.kind === 'captions' ? settings.speech() : null;
    const id = `ai-${input.kind}-${crypto.randomUUID().slice(0, 12)}`;
    const name = input.prompt.replace(/\s+/g, ' ').slice(0, 80) || t('assetGeneration.captionTrack');
    const seconds = input.kind === 'voice' ? Math.max(1, Math.min(90, input.prompt.length / 8))
      : input.kind === 'transition' ? 0.5 : speech ? (speech.endMs - speech.startMs) / 1000 : input.seconds;
    const placeholder = generationFile(input.kind, id, name, seconds);
    const at = snapToFrame(settings.time());
    const slot = generationSlot(tracks, placeholder, target, at);
    if (slot && cut) {
      const row = tracks.find((tr) => tr.docIndex === cut.track && tr.blocks.some((b) => b.clipId === cut.a));
      if (!row) return;
      slot.target = { lane: row.lane, insertTrackAt: null };
      slot.anchors = [cut.a, cut.b];
      slot.atMs = Math.max(0, cut.atMs - 250);
    } else if (slot && speech) {
      const row = tracks.find((tr) => tr.blocks.some((b) => b.clipId === speech.clipId));
      slot.target = { lane: null, insertTrackAt: row?.docIndex ?? 0 };
      slot.atMs = speech.startMs;
    } else if (slot && ['filter', 'effect', 'text'].includes(input.kind) && anchor?.blocks.length && !anchor.overlay && !anchor.text) {
      slot.target = { lane: null, insertTrackAt: anchor.docIndex! };
      slot.atMs = at;
    } else if (slot && ['filter', 'effect', 'text'].includes(input.kind) && target == null && slot.target.lane) {
      const row = tracks.find((tr) => tr.lane === slot.target.lane);
      if (row?.blocks.length && !row.overlay && !row.text) {
        slot.target = { lane: null, insertTrackAt: row.docIndex! };
        slot.atMs = at;
      }
    }
    if (!slot || (input.kind === 'transition' && !cut) || (input.kind === 'captions' && !speech)) {
      setStatus({ kind: input.kind, label: name, error: t(!slot ? 'timeline.trackLocked' : input.kind === 'transition' ? 'assetDrawer.noCut' : 'assetGeneration.speechHint') });
      return;
    }
    const cutNames = cut ? [cut.a, cut.b].map((clip) => tracks.flatMap((tr) => tr.blocks).find((b) => b.clipId === clip)?.title ?? clip).join(' → ') : '';
    void run({ id, input, placeholder, slot, cut, cutNames, speech });
  }

  return {
    start, status,
    retry: () => { if (current.current?.error) void run({ ...current.current, error: undefined }); },
    dismiss: () => { if (!current.current || current.current.error) show(null); },
    target: options.tracks().find((row) => row.docIndex === options.target())?.badge ?? null,
    cut: Boolean(options.cut()),
    speech: Boolean(options.speech()),
  };
}
