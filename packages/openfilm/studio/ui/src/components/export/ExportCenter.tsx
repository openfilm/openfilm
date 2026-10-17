/**
 * The export center: the project menu's "Export".
 *
 * Organized by where the film is going, not by format: a platform, an editor, a GIF, the sound, stills. Each
 * destination has its own few settings and a one-line summary of what comes out, and one primary button says what
 * happens.
 *
 * Everything renders on this machine, in Studio's server (see lib/export-jobs): the dialog closes as soon as the
 * exports are queued, and the export tray follows them.
 *
 * What was chosen last time for each destination is kept in this browser (localStorage) and comes back next time.
 */
import {
  AlertTriangle, AudioLines, Captions, Check, Clapperboard, Download, Film, FolderArchive, FolderOpen, Images, Layers, Loader2, MonitorPlay, Presentation,
  Sparkles, X,
} from 'lucide-react';
import React from 'react';
import { createPortal } from 'react-dom';

import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { MenuSelect } from '@/components/MenuSelect';
import { CustomFrame } from '@/components/FramePicker';
import { FRAME_RATES } from '@/lib/timecode';
import { api } from '@/api';
import {
  CODEC_LABEL,
  EXPORT_ALPHA_CODECS,
  exportPresetsFor,
  exportDimsForShortEdge,
  exportEstimateBytes,
  exportFilmPixels,
  exportFramedDims,
  exportGifDims,
  exportGifEstimateBytes,
  exportPreset,
  rangeMarks,
  type ExportPresetGroup,
  type ExportQuality,
  type ExportVideoCodec,
} from '@/lib/export-spec';
import {
  formatBytes,
  formatFilmTime,
  listExports,
  probeFps,
  PROJECT_PARTS,
  startExports,
  type ExportCapabilities,
  type ExportJob,
  type ExportRequest,
  type ProjectPart,
  type ProjectSizes,
} from '@/lib/export-jobs';
import { FILM_FRAME_IDS, filmFrameBox, filmFrameRatio, type FilmFrameFill, type FilmFrameId } from '@/lib/film-frame';

type Dest = 'social' | 'video' | 'alpha' | 'nle' | 'gif' | 'audio' | 'subtitles' | 'images' | 'slides' | 'project';

const DESTS: readonly { id: Dest; icon: React.ReactNode }[] = [
  { id: 'video', icon: <Film size={16} /> },
  { id: 'nle', icon: <Clapperboard size={16} /> },
  { id: 'social', icon: <MonitorPlay size={16} /> },
  { id: 'alpha', icon: <Layers size={16} /> },
  { id: 'gif', icon: <Sparkles size={16} /> },
  { id: 'audio', icon: <AudioLines size={16} /> },
  { id: 'subtitles', icon: <Captions size={16} /> },
  { id: 'images', icon: <Images size={16} /> },
  { id: 'slides', icon: <Presentation size={16} /> },
  { id: 'project', icon: <FolderArchive size={16} /> },
];

/** XML destinations: names are not translated; formats and help stay with their editor. */
const NLE_APPS = {
  premiere: { name: 'Premiere Pro', format: 'xml', hint: 'exportCenter.nleHintPremiere' },
  resolve: { name: 'DaVinci Resolve', format: 'xml', hint: 'exportCenter.nleHintResolve' },
  finalcut: { name: 'Final Cut Pro', format: 'fcpxml', hint: 'exportCenter.nleHintFinalCut' },
} as const;
const DRAFT_APP_NAME = { jianying: '剪映', capcut: 'CapCut' } as const;

/** "As now" in a frame choice: the delivery frame picked beside the player. */
type FrameChoice = FilmFrameId | 'current';

/** The stems the server makes (exports.mjs STEMS): a video's own sound is the footage's, whatever the timeline calls it. */
type StemKind = 'voice' | 'music' | 'sfx' | 'footage';
const STEM_KINDS: readonly StemKind[] = ['voice', 'music', 'sfx', 'footage'];

/** "The whole film" in the transparent source list (a block is its clip id). */
const WHOLE_FILM = '__film__';

interface Settings {
  dest: Dest;
  presets: string[];
  socialQuality: ExportQuality;
  /** Burned-in subtitles on platform exports: each platform's habit, all, or none. */
  socialSubs: 'auto' | 'on' | 'off';
  video: {
    codec: ExportVideoCodec;
    shortEdge: number;
    fps: number | 'source';
    quality: ExportQuality;
    frame: FrameChoice;
    fill: FilmFrameFill;
    audio: boolean;
    burn: boolean;
    sidecar: 'none' | 'srt' | 'vtt';
  };
  gif: { width: number; fps: number; frame: FrameChoice; fill: FilmFrameFill; burn: boolean };
  /** `source`: a block's clip id, or the whole film. */
  alpha: { codec: ExportVideoCodec; source: string; shortEdge: number; scale: number; fps: number; audio: boolean };
  audio: { format: 'wav' | 'm4a' | 'mp3'; mix: boolean; stems: boolean };
  /** For an editing program: the sound as clips or as mixed stems. */
  /** the app it is for: `draft` 剪映 (in Chinese) or CapCut (elsewhere), the same draft; `auto`: the draft when that app
      is on this computer, else Premiere Pro */
  nle: { app: 'auto' | 'draft' | keyof typeof NLE_APPS; fps: number | 'source'; audio: 'clips' | 'stems'; subtitles: boolean };
  subtitles: { format: 'srt' | 'vtt' | 'txt' };
  images: { format: 'png' | 'jpg'; shortEdge: number; frame: FrameChoice; fill: FilmFrameFill; burn: boolean };
  slides: { format: 'pptx' | 'pdf'; shortEdge: number; frame: FrameChoice; fill: FilmFrameFill; burn: boolean };
  /** The project itself: a zip or a folder, and which parts besides its work (conversations and logs are private). */
  project: { as: 'zip' | 'folder' } & Record<ProjectPart, boolean>;
  /** Where exports are written. Empty = the default folder. */
  folder: string;
}

const DEFAULTS: Settings = {
  dest: 'video',
  presets: ['youtube'],
  socialQuality: 'high',
  socialSubs: 'auto',
  video: {
    codec: 'h264', shortEdge: 1080, fps: 'source', quality: 'high', frame: 'current', fill: 'contain', audio: true, burn: true, sidecar: 'none',
  },
  gif: { width: 640, fps: 15, frame: 'current', fill: 'contain', burn: true },
  alpha: { codec: 'prores4444', source: WHOLE_FILM, shortEdge: 1080, scale: 1, fps: 30, audio: true },
  audio: { format: 'wav', mix: true, stems: false },
  nle: { app: 'auto', fps: 'source', audio: 'clips', subtitles: true },
  subtitles: { format: 'srt' },
  images: { format: 'png', shortEdge: 1080, frame: 'current', fill: 'contain', burn: false },
  slides: { format: 'pptx', shortEdge: 1080, frame: 'current', fill: 'contain', burn: false },
  project: { as: 'zip', history: false, chat: false, logs: false },
  folder: '',
};

const STORE_KEY = 'openfilm.exportCenter.v1';

/** What was chosen last time; the first time, the defaults (哔哩哔哩 rather than YouTube in Chinese). */
function loadSettings(language: string): Settings {
  const first = language === 'zh-CN' ? { ...DEFAULTS, presets: ['bilibili'] } : DEFAULTS;
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Settings> | null;
    if (!raw || typeof raw !== 'object') return first;
    const nle = { ...DEFAULTS.nle, ...raw.nle };
    if (nle.app !== 'auto' && nle.app !== 'draft' && !Object.hasOwn(NLE_APPS, nle.app)) nle.app = 'auto';
    return {
      ...DEFAULTS,
      ...raw,
      presets: Array.isArray(raw.presets) ? raw.presets.filter((id) => exportPreset(id)) : DEFAULTS.presets,
      video: { ...DEFAULTS.video, ...raw.video },
      gif: { ...DEFAULTS.gif, ...raw.gif },
      alpha: { ...DEFAULTS.alpha, ...raw.alpha },
      audio: { ...DEFAULTS.audio, ...raw.audio },
      nle,
      subtitles: { ...DEFAULTS.subtitles, ...raw.subtitles },
      images: { ...DEFAULTS.images, ...raw.images },
      slides: { ...DEFAULTS.slides, ...raw.slides },
      /* the parts besides the work start off each time (history, chat and logs are the person's own): only zip or
         folder is kept */
      project: { ...DEFAULTS.project, ...(raw.project?.as === 'folder' ? { as: 'folder' } : {}) },
    };
  } catch {
    return first;
  }
}

function saveSettings(s: Settings): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* storage off (private window) */ }
}

const SHORT_EDGES = [480, 720, 1080, 1440, 2160];
const STILL_EDGES = [720, 1080, 1440, 2160];
/** A video's rates: the project's list (lib/timecode), one spec for both. */
const FPS_CHOICES = FRAME_RATES;
const GIF_WIDTHS = [320, 480, 640, 800, 1080];
const GIF_FPS = [10, 12, 15, 20, 24];
const VIDEO_CODECS: ExportVideoCodec[] = ['h264', 'hevc', 'prores422hq', 'prores4444', 'hevc_alpha', 'vp9', 'png'];
const ALPHA_SCALES = [0.5, 1, 2];
const PRESET_GROUPS: ExportPresetGroup[] = ['landscape', 'vertical', 'feed'];
/** The rates editors take; a source at another NTSC rate (23.976, 59.94) comes as the "source" choice. */
const NLE_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
const VIDEO_SRC = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i;

/** Whether this machine's ffmpeg makes a codec (unknown until the server answers: assumed yes). */
function codecAvailable(codec: ExportVideoCodec, can: ExportCapabilities | null): boolean {
  if (!can) return true;
  switch (codec) {
    case 'h264': return can.h264;
    case 'hevc': return can.hevc;
    case 'hevc_alpha': return can.hevcAlpha;
    case 'vp9': return can.vp9;
    case 'prores422hq':
    case 'prores4444': return can.prores;
    case 'png': return true;
  }
}

export interface ExportCenterProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  title: string;
  /** The film's length. */
  durationMs: number;
  stage: { w: number; h: number };
  /** The delivery frame picked beside the player. */
  frame: FilmFrameId;
  /**
   * What the timeline shows (its picture clips and sounds): scene boundaries for the range, the count of scene
   * stills, which stems there are. Missing: the range is the whole film or a part from 0, and the server finds the rest.
   */
  film?: {
    scenes: readonly { startMs: number; durMs: number; label: string; src?: string }[];
    sounds: readonly { kind: Exclude<StemKind, 'footage'>; durMs: number; src?: string }[];
  } | null;
  /** Where the playhead is: the poster is that frame (the middle of the film without it). */
  playheadMs?: number;
  /** The timeline's motion-graphic blocks: a transparent export can be just one of them. */
  mgBlocks?: readonly { clipId: string; label: string; startMs: number; durMs: number }[];
  /** From a block's "Export this clip": opens on transparent assets with that block chosen. */
  focusClipId?: string;
  /** The exports were queued (the tray shows them). */
  onQueued?: (jobs: ExportJob[]) => void;
  /** The project's frame rate (`.film/settings.json`, else its footage's): a video's rate unless another is picked. */
  projectFps?: number;
  /** Media files the film uses that are gone: an export that draws or plays the film stops at them, so it is held back. */
  missingFiles?: readonly string[];
}

/** What draws or plays the film, and so needs every file it uses. */
const RENDERS: ReadonlySet<Dest> = new Set(['social', 'video', 'alpha', 'gif', 'audio', 'images', 'slides']);

export function ExportCenter(props: ExportCenterProps) {
  const { open, onClose } = props;
  const t = useT();
  const language = useLanguage();
  /** the platforms offered in this language (a platform picked in another and not offered here is not exported) */
  const presets = React.useMemo(() => exportPresetsFor(language), [language]);
  const [can, setCan] = React.useState<ExportCapabilities | null>(null);
  /** 剪映 and CapCut on this computer: an editing project for one goes into its drafts */
  const [draftApps, setDraftApps] = React.useState<{ jianying: boolean; capcut: boolean }>({ jianying: false, capcut: false });
  const [s, setS] = React.useState<Settings>(DEFAULTS);
  const [hydrated, setHydrated] = React.useState(false);
  const [range, setRange] = React.useState<{ on: boolean; from: number; to: number }>({ on: false, from: 0, to: 0 });
  const [working, setWorking] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [defaultFolder, setDefaultFolder] = React.useState<string>('');
  /** How many subtitle cues the film has (null until the server says). */
  const [captionCount, setCaptionCount] = React.useState<number | null>(null);
  /** How big the project and each of its parts are (null: not known yet). */
  const [projectSizes, setProjectSizes] = React.useState<ProjectSizes | null>(null);
  /** The footage's frame rate, as an editor's rate (an editor wants the source's exact rate: 29.97 in a 30 timeline slips a frame every 1,000). */
  const [nleSourceFps, setNleSourceFps] = React.useState<number | null>(null);
  /** The folder being typed after "Change…" (null when not editing). */
  const [folderDraft, setFolderDraft] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const loaded = loadSettings(language);
    setS(props.focusClipId
      ? { ...loaded, dest: 'alpha', alpha: { ...loaded.alpha, source: props.focusClipId } }
      : loaded);
    setHydrated(true);
    setResult(null);
    setWorking(null);
    setFolderDraft(null);
    setRange((r) => ({ ...r, on: false }));
    void listExports(props.projectId).then((r) => { setCan(r.can); setDraftApps({ jianying: Boolean(r.drafts?.jianying), capcut: Boolean(r.drafts?.capcut) }); setDefaultFolder(r.folder); setCaptionCount(r.subtitles ?? 0); setProjectSizes(r.project ?? null); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (hydrated) saveSettings(s);
  }, [s, hydrated]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !working) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, working]);

  const stage = props.stage;
  const totalMs = props.durationMs;
  const film = props.film ?? null;
  const soundKinds = React.useMemo(
    () => new Set<StemKind>((film?.sounds ?? []).filter((x) => x.durMs > 0).map((x) => (x.src && VIDEO_SRC.test(x.src) ? 'footage' : x.kind))),
    [film],
  );
  const knownSilent = film != null && soundKinds.size === 0;

  const blocks = React.useMemo(() => props.mgBlocks ?? [], [props.mgBlocks]);
  const captions = captionCount ?? 0;

  /* the first footage clip's rate, for the editor's "source" choice */
  const footageSrc = React.useMemo(
    () => [...(film?.scenes ?? [])].sort((a, b) => a.startMs - b.startMs).find((sc) => sc.src && VIDEO_SRC.test(sc.src))?.src ?? null,
    [film],
  );
  React.useEffect(() => {
    setNleSourceFps(null);
    if (!open || !footageSrc) return undefined;
    let live = true;
    void probeFps(props.projectId, footageSrc).then((fps) => {
      if (!live || fps == null) return;
      setNleSourceFps(NLE_FPS.find((f) => Math.abs(f - fps) < 0.05) ?? null);
    }).catch(() => {});
    return () => { live = false; };
  }, [open, footageSrc, props.projectId]);

  /* where a part can start and end: the picture clips' edges, each named by its clips (rangeMarks) */
  const boundaries = React.useMemo(() => rangeMarks(film?.scenes ?? [], totalMs), [film, totalMs]);
  /* one still from the middle of each picture clip (clips starting together give one): what the server makes */
  const stillCount = React.useMemo(() => {
    if (!film) return 1;
    let lastAt = -Infinity;
    let n = 0;
    for (const sc of [...film.scenes].sort((a, b) => a.startMs - b.startMs)) {
      if (!(sc.durMs > 0) || sc.startMs >= totalMs || sc.startMs - lastAt < 400) continue;
      lastAt = sc.startMs;
      n++;
    }
    return Math.max(1, Math.min(120, n));
  }, [film, totalMs]);

  React.useEffect(() => {
    setRange((r) => ({ ...r, from: 0, to: totalMs }));
  }, [totalMs]);

  const exportRange = range.on && range.to > range.from && (range.from > 0 || range.to < totalMs)
    ? { fromMs: range.from, toMs: range.to }
    : undefined;
  const rangeMs = exportRange ? exportRange.toMs - exportRange.fromMs : totalMs;
  const rangeSec: [number, number] | undefined = exportRange ? [exportRange.fromMs / 1000, exportRange.toMs / 1000] : undefined;

  const resolveFrame = (f: FrameChoice): FilmFrameId => (f === 'current' ? props.frame : f);
  /* 'source' is the project's own rate */
  const projectFps = props.projectFps ?? 30;
  const fpsFor = (f: number | 'source'): number => (f === 'source' ? projectFps : f);

  const patch = <K extends keyof Settings>(key: K, value: Partial<Settings[K]> | Settings[K]) => {
    setS((prev) => ({
      ...prev,
      [key]: typeof value === 'object' && !Array.isArray(value) && value !== null
        ? { ...(prev[key] as object), ...(value as object) }
        : value,
    }));
  };

  const dest: Dest = DESTS.some((d) => d.id === s.dest) ? s.dest : 'video';
  const alphaBlock = blocks.find((b) => b.clipId === s.alpha.source);
  /* how long what comes out is: one element alone is its own length, not the film's */
  const outMs = dest === 'alpha' && alphaBlock ? alphaBlock.durMs : rangeMs;
  const videoCodec: ExportVideoCodec = codecAvailable(s.video.codec, can) && VIDEO_CODECS.includes(s.video.codec) ? s.video.codec : 'h264';
  const alphaCodec: ExportVideoCodec = EXPORT_ALPHA_CODECS.includes(s.alpha.codec) && codecAvailable(s.alpha.codec, can) ? s.alpha.codec : 'prores4444';
  const audioFormat = s.audio.format === 'mp3' && can && !can.mp3 ? 'wav' : s.audio.format;
  /* the same draft is 剪映's or CapCut's: the one on this computer, else (both or neither) 剪映 in Chinese and CapCut in
     any other language; always by its own name */
  const known: 'jianying' | 'capcut' = language === 'zh-CN' ? 'jianying' : 'capcut';
  const draftApp = draftApps[known] || !draftApps[known === 'jianying' ? 'capcut' : 'jianying'] ? known : known === 'jianying' ? 'capcut' : 'jianying';
  const draftHere = draftApps[draftApp];
  /** a translation naming the draft's app */
  const tApp = (path: string) => t(path).replaceAll('{app}', DRAFT_APP_NAME[draftApp]);
  const nleApp = s.nle.app === 'auto' ? (draftHere ? 'draft' : 'premiere') : s.nle.app;
  /* a draft goes into its app's drafts folder, whatever folder is picked */
  const toDrafts = dest === 'nle' && nleApp === 'draft' && draftHere;
  const codecName = (c: ExportVideoCodec) => CODEC_LABEL[c] + (c === 'png' ? ` ${t('exportCenter.sequence')}` : '');

  /* the parts of the project asked that it has (a part it has none of is left out) */
  const projectParts = React.useMemo(
    () => PROJECT_PARTS.filter((part) => s.project[part] && (projectSizes == null || projectSizes[part] != null)),
    [s.project, projectSizes],
  );

  /* ── the exports this screen asks for ── */
  const requests = React.useMemo((): ExportRequest[] => {
    const ranged = rangeSec ? { range: rangeSec } : {};
    /* subtitles drawn into the picture: only a film that has some */
    const burn = (on: boolean) => (captions > 0 && on ? { burnSubtitles: true } : {});
    switch (dest) {
      case 'social':
        return s.presets.map((id) => presets.find((p) => p.id === id) ?? null).filter((p) => p !== null).map((p) => ({
          kind: 'video', codec: 'h264', frame: p.frame, fill: 'contain', shortEdge: p.shortEdge, fps: p.fps,
          quality: s.socialQuality, audio: true, preset: p.name, label: p.name,
          ...burn(s.socialSubs === 'auto' ? p.burnSubtitles : s.socialSubs === 'on'), ...ranged,
        }));
      case 'video': {
        const v = s.video;
        return [{
          kind: 'video', codec: videoCodec, frame: resolveFrame(v.frame), fill: v.fill, shortEdge: v.shortEdge, fps: fpsFor(v.fps),
          quality: v.quality, audio: v.audio, label: codecName(videoCodec), ...burn(v.burn),
          ...(captions > 0 && v.sidecar !== 'none' && videoCodec !== 'png' ? { sidecar: v.sidecar } : {}), ...ranged,
        }];
      }
      case 'alpha': {
        const a = s.alpha;
        return alphaBlock
          ? [{ kind: 'video', codec: alphaCodec, clip: alphaBlock.clipId, scale: a.scale, fps: a.fps, quality: 'high', audio: a.audio, label: alphaBlock.label }]
          : [{ kind: 'video', codec: alphaCodec, frame: 'native', shortEdge: a.shortEdge, fps: a.fps, quality: 'high', audio: a.audio, label: codecName(alphaCodec), ...ranged }];
      }
      case 'gif':
        return [{ kind: 'gif', frame: resolveFrame(s.gif.frame), fill: s.gif.fill, width: s.gif.width, fps: s.gif.fps, label: 'GIF', ...burn(s.gif.burn), ...ranged }];
      case 'audio': {
        const stems = s.audio.stems;
        return [{ kind: 'audio', format: audioFormat, stems, mix: stems ? s.audio.mix : true, label: t(stems ? 'exportCenter.audioStems' : 'exportCenter.audioMix'), ...ranged }];
      }
      case 'nle':
        return [{
          kind: 'nle', format: nleApp === 'draft' ? draftApp : NLE_APPS[nleApp].format, fps: s.nle.fps === 'source' ? (nleSourceFps ?? projectFps) : s.nle.fps, audio: s.nle.audio, media: 'copy',
          subtitles: s.nle.subtitles, label: nleApp === 'draft' ? tApp('exportCenter.nleDraftTitle') : `${NLE_APPS[nleApp].name} XML`,
        }];
      case 'subtitles':
        return [{ kind: 'subtitles', format: s.subtitles.format, label: s.subtitles.format === 'txt' ? t('exportCenter.transcript') : s.subtitles.format.toUpperCase(), ...ranged }];
      case 'images':
        return [{
          kind: 'stills', format: s.images.format, shortEdge: s.images.shortEdge, frame: resolveFrame(s.images.frame), fill: s.images.fill,
          label: t('exportCenter.stills'), ...burn(s.images.burn),
        }];
      case 'slides':
        return [{
          kind: 'slides', format: s.slides.format, shortEdge: s.slides.shortEdge, frame: resolveFrame(s.slides.frame), fill: s.slides.fill,
          label: s.slides.format === 'pdf' ? 'PDF' : 'PowerPoint', ...burn(s.slides.burn),
        }];
      case 'project':
        return [{
          kind: 'project', as: s.project.as, parts: projectParts,
          label: t(s.project.as === 'zip' ? 'exportCenter.projectZip' : 'exportCenter.projectFolder'),
        }];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest, s, can, presets, nleApp, draftApp, rangeSec?.[0], rangeSec?.[1], props.frame, blocks, nleSourceFps, captions, projectParts]);

  /* a range, not a size: what is in the picture decides a video's or a GIF's size (export-spec.ts); sound is exact */
  const estBytes = React.useMemo(() => requests.reduce<[number, number]>(([low, high], r) => {
    const add = ([a, b]: readonly [number, number]): [number, number] => [low + a, high + b];
    if (r.kind === 'video') {
      /* one block's size depends on the block: not guessed */
      if (r.clip) return [low, high];
      const frame = r.frame ?? 'native', fill = r.fill ?? 'contain';
      const size = exportFramedDims(stage, frame, fill, r.shortEdge ?? Math.min(stage.w, stage.h));
      return add(exportEstimateBytes({
        codec: r.codec, size, filmPixels: exportFilmPixels(stage, frame, fill, size), fps: r.fps, quality: r.quality, durationMs: rangeMs,
        audio: r.audio && r.codec !== 'png' && !knownSilent,
      }));
    }
    if (r.kind === 'gif') {
      const frame = r.frame ?? 'native', fill = r.fill ?? 'contain';
      const size = exportGifDims(filmFrameBox(stage, frame, fill), r.width);
      return add(exportGifEstimateBytes({ size, filmPixels: exportFilmPixels(stage, frame, fill, size), fps: r.fps, durationMs: rangeMs }));
    }
    if (r.kind === 'audio') {
      /* 48 kHz 16-bit stereo; AAC and MP3 at 256k (exports.mjs SOUND_CODECS) */
      const per = r.format === 'wav' ? 192_000 : 32_000;
      const files = (r.mix ? 1 : 0) + (r.stems ? soundKinds.size : 0);
      const bytes = per * (rangeMs / 1000) * Math.max(1, files);
      return add([bytes, bytes]);
    }
    if (r.kind === 'project' && projectSizes) {
      const bytes = r.parts.reduce((n, part) => n + (projectSizes[part] ?? 0), projectSizes.work);
      return add([bytes, bytes]);
    }
    return [low, high];
  }, [0, 0]), [requests, stage, rangeMs, soundKinds, knownSilent, projectSizes]);
  /* "about 0.8 MB–8 MB"; one size when both ends read the same */
  const estText = estBytes[1] > 0 ? [...new Set(estBytes.map((b) => formatBytes(b)))].join('–') : '';

  const folder = s.folder || defaultFolder;

  const fileCount = requests.reduce((n, r) => {
    if (r.kind === 'audio') return n + (r.mix ? 1 : 0) + (r.stems ? Math.max(1, soundKinds.size) : 0);
    if (r.kind === 'video' && r.sidecar) return n + 2;
    return n + 1;
  }, 0);

  /* files the film uses that are gone: said first, by name, before anything is queued (it would stop at them) */
  const missing = props.missingFiles ?? [];
  const missingReason = missing.length && RENDERS.has(dest)
    ? t('exportCenter.missingMedia').replace('{n}', String(missing.length))
      .replace('{files}', missing.slice(0, 3).map((f) => f.split('/').pop()).join(', ') + (missing.length > 3 ? ', …' : ''))
    : null;
  const emptyReason = ((): string | null => {
    if (missingReason) return missingReason;
    if (!totalMs && dest !== 'project') return t('exportCenter.emptyFilm');
    if (dest === 'social' && requests.length === 0) return t('exportCenter.pickPreset');
    if (dest === 'subtitles' && captionCount != null && captions === 0) return t('exportCenter.noCaptions');
    if (dest === 'audio' && knownSilent) return t('exportCenter.noAudio');
    return null;
  })();

  /* ── doing it ── */
  const queue = async (jobs: ExportRequest[]) => {
    if (working) return;
    setResult(null);
    if (!folder) {
      setResult({ ok: false, text: t('exportCenter.noFolder') });
      return;
    }
    setWorking(t('exportCenter.queueing'));
    try {
      const queued = await startExports(props.projectId, jobs, s.folder || undefined);
      props.onQueued?.(queued);
      onClose();
    } catch (e) {
      setResult({ ok: false, text: e instanceof TypeError ? t('exportCenter.engineDown') : (e instanceof Error ? e.message : String(e)) });
    } finally {
      setWorking(null);
    }
  };

  /* the poster is the frame at the playhead; at the very start (often a fade from black) the film's middle */
  const posterAt = props.playheadMs != null && props.playheadMs > 0 && props.playheadMs < totalMs ? props.playheadMs / 1000 : undefined;
  const exportPoster = () => {
    const at = posterAt;
    void queue([{
      kind: 'poster', format: s.images.format, shortEdge: s.images.shortEdge, frame: resolveFrame(s.images.frame), fill: s.images.fill,
      label: t('exportCenter.poster'), ...(at != null ? { at } : {}), ...(captions > 0 && s.images.burn ? { burnSubtitles: true } : {}),
    }]);
  };

  const commitFolder = () => {
    if (folderDraft == null) return;
    const next = folderDraft.trim();
    patch('folder', next === defaultFolder ? '' : next);
    setFolderDraft(null);
  };
  /* the app's own folder dialog where there is an app (lib/host.ts `folders`); in a browser, the path typed */
  /* the system's folder dialog: the app's own where there is an app (lib/host.ts `folders`), else the one Studio opens
     on this computer for the page; only where neither can, the path is typed */
  const [picking, setPicking] = React.useState(false);
  const changeFolder = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const ask = { title: t('exportCenter.pickTitle'), button: t('exportCenter.pickButton'), ...(folder ? { at: folder } : {}) };
      const pick = studioHost?.folders?.pick;
      const picked = pick ? await pick(ask) : await api.pickFolder(ask.title, ask.at);
      if (picked) patch('folder', picked === defaultFolder ? '' : picked);
    } catch {
      setFolderDraft(folder);
    } finally {
      setPicking(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const primaryLabel = working
    ?? (fileCount > 1 ? t('exportCenter.exportN').replace('{n}', String(fileCount)) : t('exportCenter.export'));
  const disabled = Boolean(working) || Boolean(emptyReason) || !folder;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      onClick={() => { if (!working) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('exportCenter.title')}
        className="flex h-[min(640px,calc(100vh-32px))] w-full max-w-[880px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
        style={{ animation: 'openfilm-rise 0.16s ease-out both' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* left: destinations */}
        {/* the list scrolls when the window is short; the note under it stays whole */}
        <nav className="flex min-h-0 w-[212px] shrink-0 flex-col border-r border-[var(--border-soft)] bg-[var(--surface-2)]">
          <h2 className="shrink-0 px-5 pb-2 pt-4 text-[15px] font-semibold tracking-tight text-[var(--text)]">{t('exportCenter.title')}</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-2">
          {DESTS.map((d) => {
            const on = dest === d.id;
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={on}
                onClick={() => { patch('dest', d.id); setResult(null); }}
                className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                  on ? 'bg-[var(--surface)] shadow-[var(--shadow-sm)]' : 'hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className={`mt-0.5 shrink-0 ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{d.icon}</span>
                <span className="min-w-0">
                  <span className={`block text-[13px] font-medium ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                    {t(`exportCenter.dest.${d.id}`)}
                  </span>
                  <span className="block text-[11px] leading-snug text-[var(--text-faint)]">{tApp(`exportCenter.destHint.${d.id}`)}</span>
                </span>
              </button>
            );
          })}
          </div>
          <div className="shrink-0 border-t border-[var(--border-soft)] px-5 py-3 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
            {t('exportCenter.engineDesktop')}
          </div>
        </nav>

        {/* right: settings and summary */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 px-5 pb-1 pt-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold text-[var(--text)]">{t(`exportCenter.dest.${dest}`)}</h3>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-muted)]">{tApp(`exportCenter.destDesc.${dest}`)}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={Boolean(working)}
              aria-label={t('exportDialog.close')}
              className="self-start rounded-lg p-1 text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              <X size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3">
            <div className="flex flex-col gap-5">
              {dest === 'social' && (
                <>
                  {PRESET_GROUPS.map((group) => (
                    <Field key={group} label={t(`exportCenter.group.${group}`)}>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {presets.filter((p) => p.group === group).map((p) => {
                          const on = s.presets.includes(p.id);
                          const dims = exportDimsForShortEdge(filmFrameBox(stage, p.frame), p.shortEdge);
                          const tooLong = p.maxDurationSec != null && rangeMs / 1000 > p.maxDurationSec;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              aria-pressed={on}
                              onClick={() => patch('presets', on ? s.presets.filter((id) => id !== p.id) : [...s.presets, p.id])}
                              className={`relative flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition ${
                                on ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:border-[var(--text-faint)]'
                              }`}
                            >
                              <span className="flex w-full items-center gap-1.5">
                                <AspectGlyph frame={p.frame} stage={stage} />
                                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text)]">{p.name}</span>
                                {on && <Check size={13} className="shrink-0 text-[var(--text)]" />}
                              </span>
                              <span className="text-[11px] tabular-nums text-[var(--text-faint)]">
                                {dims.w}×{dims.h} · {p.fps}fps
                              </span>
                              {tooLong && (
                                <span className="text-[10.5px] leading-snug text-[var(--warn)]">
                                  {t('exportCenter.tooLong').replace('{max}', formatFilmTime(p.maxDurationSec! * 1000))}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                  ))}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label={t('exportCenter.quality')}>
                      <QualityPicker value={s.socialQuality} onChange={(q) => patch('socialQuality', q)} t={t} />
                    </Field>
                    {captions > 0 && (
                      <Field label={t('exportCenter.burnSubtitles')}>
                        <Segmented
                          value={s.socialSubs}
                          options={[
                            { value: 'auto', label: t('exportCenter.subsAuto') },
                            { value: 'on', label: t('exportCenter.subsOn') },
                            { value: 'off', label: t('exportCenter.subsOff') },
                          ]}
                          onChange={(v) => patch('socialSubs', v)}
                        />
                      </Field>
                    )}
                  </div>
                  <Hint>{t('exportCenter.socialHint')}</Hint>
                </>
              )}

              {dest === 'video' && (
                <>
                  <Field label={t('exportCenter.codec')}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {VIDEO_CODECS.map((c) => {
                        const unavailable = !codecAvailable(c, can);
                        return (
                          <OptionCard
                            key={c}
                            on={videoCodec === c}
                            disabled={unavailable}
                            title={codecName(c)}
                            desc={unavailable ? t('exportCenter.notOnThisComputer') : t(`exportCenter.codecHint.${c}`)}
                            onClick={() => patch('video', { codec: c })}
                          />
                        );
                      })}
                    </div>
                  </Field>
                  <FrameField
                    value={s.video.frame}
                    fill={s.video.fill}
                    current={props.frame}
                    stage={stage}
                    onChange={(frame) => patch('video', { frame })}
                    onFill={(fill) => patch('video', { fill })}
                    t={t}
                  />
                  <Field label={t('exportCenter.resolution')}>
                    <Chips
                      value={s.video.shortEdge}
                      options={SHORT_EDGES.map((p) => {
                        const d = exportFramedDims(stage, resolveFrame(s.video.frame), s.video.fill, p);
                        return { value: p, label: p === 2160 ? '4K' : `${p}p`, sub: `${d.w}×${d.h}` };
                      })}
                      onChange={(shortEdge) => patch('video', { shortEdge })}
                    />
                  </Field>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label={t('exportCenter.fps')}>
                      <FpsSelect
                        label={t('exportCenter.fps')}
                        value={fpsFor(s.video.fps)}
                        rates={FPS_CHOICES}
                        own={{ fps: projectFps, note: t('exportCenter.fpsProject') }}
                        onPick={(fps) => patch('video', { fps: fps === projectFps ? 'source' : fps })}
                      />
                    </Field>
                    {!(videoCodec.startsWith('prores') || videoCodec === 'png') && (
                      <Field label={t('exportCenter.quality')}>
                        <QualityPicker value={s.video.quality} onChange={(quality) => patch('video', { quality })} t={t} />
                      </Field>
                    )}
                  </div>
                  {videoCodec !== 'png' && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label={t('exportCenter.audio')}>
                        <Toggle checked={s.video.audio} onChange={(audio) => patch('video', { audio })} label={t('exportCenter.includeAudio')} />
                      </Field>
                      {captions > 0 && (
                        <Field label={t('exportCenter.subtitles')}>
                          <Toggle checked={s.video.burn} onChange={(burn) => patch('video', { burn })} label={t('exportCenter.burnIn')} />
                          <div className="mt-2">
                            <Segmented
                              value={s.video.sidecar}
                              options={[
                                { value: 'none', label: t('exportCenter.noSidecar') },
                                { value: 'srt', label: '+ SRT' },
                                { value: 'vtt', label: '+ VTT' },
                              ]}
                              onChange={(sidecar) => patch('video', { sidecar })}
                            />
                          </div>
                        </Field>
                      )}
                    </div>
                  )}
                </>
              )}

              {dest === 'alpha' && (
                <>
                  <Field label={t('exportCenter.alphaSource')}>
                    <div className="flex max-h-[200px] flex-col gap-1.5 overflow-y-auto pr-1">
                      {[{ clipId: WHOLE_FILM, label: t('exportCenter.alphaWhole'), startMs: 0, durMs: totalMs }, ...blocks].map((b) => {
                        const on = (alphaBlock ? alphaBlock.clipId : WHOLE_FILM) === b.clipId;
                        return (
                          <button
                            key={b.clipId}
                            type="button"
                            aria-pressed={on}
                            onClick={() => patch('alpha', { source: b.clipId })}
                            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
                              on ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:border-[var(--text-faint)]'
                            }`}
                          >
                            <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${on ? 'border-[4px] border-[var(--text)]' : 'border-[var(--text-faint)]'}`} />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text)]">{b.label}</span>
                            <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-faint)]">
                              {b.clipId === WHOLE_FILM ? t('exportCenter.alphaWholeHint') : `${formatFilmTime(b.startMs)} · ${formatFilmTime(b.durMs)}`}
                            </span>
                          </button>
                        );
                      })}
                      {blocks.length === 0 && <Hint>{t('exportCenter.alphaNoBlocks')}</Hint>}
                    </div>
                  </Field>
                  <Field label={t('exportCenter.format')}>
                    <div className="grid grid-cols-2 gap-2">
                      {EXPORT_ALPHA_CODECS.map((c) => {
                        const unavailable = !codecAvailable(c, can);
                        return (
                          <OptionCard
                            key={c}
                            on={alphaCodec === c}
                            disabled={unavailable}
                            title={codecName(c)}
                            desc={unavailable ? t('exportCenter.notOnThisComputer') : t(`exportCenter.alphaCodecHint.${c}`)}
                            onClick={() => patch('alpha', { codec: c })}
                          />
                        );
                      })}
                    </div>
                  </Field>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {alphaBlock ? (
                      <Field label={t('exportCenter.alphaScale')}>
                        <Chips value={s.alpha.scale} options={ALPHA_SCALES.map((k) => ({ value: k, label: `${k}×` }))} onChange={(scale) => patch('alpha', { scale })} />
                      </Field>
                    ) : (
                      <Field label={t('exportCenter.resolution')}>
                        <Chips
                          value={s.alpha.shortEdge}
                          options={SHORT_EDGES.map((p) => ({ value: p, label: p === 2160 ? '4K' : `${p}p` }))}
                          onChange={(shortEdge) => patch('alpha', { shortEdge })}
                        />
                      </Field>
                    )}
                    <Field label={t('exportCenter.fps')}>
                      <FpsSelect
                        label={t('exportCenter.fps')}
                        value={s.alpha.fps}
                        rates={FPS_CHOICES}
                        own={{ fps: projectFps, note: t('exportCenter.fpsProject') }}
                        onPick={(fps) => patch('alpha', { fps })}
                      />
                    </Field>
                  </div>
                  {alphaCodec !== 'png' && (
                    <Toggle checked={s.alpha.audio} onChange={(audio) => patch('alpha', { audio })} label={t('exportCenter.includeAudio')} />
                  )}
                  <Callout>{t('exportCenter.alphaHint')}</Callout>
                </>
              )}

              {dest === 'nle' && (
                <>
                  <Field label={t('exportCenter.nleFor')}>
                    <Segmented
                      value={nleApp}
                      options={[
                        { value: 'draft', label: DRAFT_APP_NAME[draftApp] },
                        { value: 'premiere', label: NLE_APPS.premiere.name },
                        { value: 'resolve', label: NLE_APPS.resolve.name },
                        { value: 'finalcut', label: NLE_APPS.finalcut.name },
                      ]}
                      onChange={(app) => patch('nle', { app })}
                    />
                  </Field>
                  <Field label={t('exportCenter.fps')}>
                    <FpsSelect
                      label={t('exportCenter.fps')}
                      value={s.nle.fps === 'source' ? (nleSourceFps ?? 30) : s.nle.fps}
                      rates={NLE_FPS}
                      own={nleSourceFps ? { fps: nleSourceFps, note: t('exportCenter.fpsSource') } : null}
                      onPick={(fps) => patch('nle', { fps: fps === nleSourceFps ? 'source' : fps })}
                    />
                  </Field>
                  <Field label={t('exportCenter.nleAudio')}>
                    <Segmented
                      value={s.nle.audio}
                      options={[
                        { value: 'clips', label: t('exportCenter.nleAudioClips') },
                        { value: 'stems', label: t('exportCenter.nleAudioStems') },
                      ]}
                      onChange={(audio) => patch('nle', { audio })}
                    />
                  </Field>
                  {captions > 0 && (
                    <Toggle checked={s.nle.subtitles} onChange={(subtitles) => patch('nle', { subtitles })} label={t(nleApp === 'draft' || nleApp === 'finalcut' ? 'exportCenter.nleSubs' : 'exportCenter.nleSrt')} />
                  )}
                  <Hint>{tApp(nleApp === 'draft'
                    ? draftHere ? 'exportCenter.nleHintDraft' : 'exportCenter.nleHintDraftNone'
                    : NLE_APPS[nleApp].hint)}</Hint>
                </>
              )}

              {dest === 'gif' && (
                <>
                  <FrameField
                    value={s.gif.frame}
                    fill={s.gif.fill}
                    current={props.frame}
                    stage={stage}
                    onChange={(frame) => patch('gif', { frame })}
                    onFill={(fill) => patch('gif', { fill })}
                    t={t}
                  />
                  <Field label={t('exportCenter.gifWidth')}>
                    <Chips value={s.gif.width} options={GIF_WIDTHS.map((w) => ({ value: w, label: `${w}px` }))} onChange={(width) => patch('gif', { width })} />
                  </Field>
                  <Field label={t('exportCenter.fps')}>
                    <Chips value={s.gif.fps} options={GIF_FPS.map((f) => ({ value: f, label: `${f}` }))} onChange={(fps) => patch('gif', { fps })} />
                  </Field>
                  {captions > 0 && (
                    <Toggle checked={s.gif.burn} onChange={(burn) => patch('gif', { burn })} label={t('exportCenter.burnIn')} />
                  )}
                  <Hint>{t('exportCenter.gifHint')}</Hint>
                </>
              )}

              {dest === 'audio' && (
                <>
                  <Field label={t('exportCenter.format')}>
                    <div className="grid grid-cols-3 gap-2">
                      {(['wav', 'm4a', 'mp3'] as const).map((f) => {
                        const unavailable = f === 'mp3' && can != null && !can.mp3;
                        return (
                          <OptionCard
                            key={f}
                            on={audioFormat === f}
                            disabled={unavailable}
                            title={f.toUpperCase()}
                            desc={unavailable ? t('exportCenter.notOnThisComputer') : t(`exportCenter.audioHint.${f}`)}
                            onClick={() => patch('audio', { format: f })}
                          />
                        );
                      })}
                    </div>
                  </Field>
                  <Field label={t('exportCenter.contents')}>
                    <div className="flex flex-col gap-2">
                      <Toggle checked={s.audio.mix || !s.audio.stems} onChange={(mix) => patch('audio', { mix })} label={t('exportCenter.audioMix')} disabled={!s.audio.stems} />
                      <Toggle checked={s.audio.stems} onChange={(stems) => patch('audio', { stems })} label={t('exportCenter.audioStems')} />
                      {s.audio.stems && film && (
                        <p className="pl-6 text-[11.5px] text-[var(--text-faint)]">
                          {STEM_KINDS.filter((k) => soundKinds.has(k)).map((k) => t(`exportCenter.stem.${k}`)).join(' · ') || t('exportCenter.noAudio')}
                        </p>
                      )}
                    </div>
                  </Field>
                  <Hint>{t('exportCenter.stemsHint')}</Hint>
                </>
              )}

              {dest === 'subtitles' && (
                <>
                  <Field label={t('exportCenter.format')}>
                    <div className="grid grid-cols-3 gap-2">
                      {(['srt', 'vtt', 'txt'] as const).map((f) => (
                        <OptionCard
                          key={f}
                          on={s.subtitles.format === f}
                          title={f === 'txt' ? t('exportCenter.transcript') : f.toUpperCase()}
                          desc={t(`exportCenter.subsHint.${f}`)}
                          onClick={() => patch('subtitles', { format: f })}
                        />
                      ))}
                    </div>
                  </Field>
                  <Hint>{t('exportCenter.captionCount').replace('{n}', String(captions))}</Hint>
                </>
              )}

              {dest === 'project' && (
                <>
                  <Field label={t('exportCenter.format')}>
                    <div className="grid grid-cols-2 gap-2">
                      {(['zip', 'folder'] as const).map((as) => (
                        <OptionCard
                          key={as}
                          on={s.project.as === as}
                          title={t(as === 'zip' ? 'exportCenter.projectZip' : 'exportCenter.projectFolder')}
                          desc={t(as === 'zip' ? 'exportCenter.projectZipHint' : 'exportCenter.projectFolderHint')}
                          onClick={() => patch('project', { as })}
                        />
                      ))}
                    </div>
                  </Field>
                  <Field label={t('exportCenter.contents')}>
                    <div className="flex flex-col gap-2.5">
                      <PartToggle
                        checked
                        locked
                        onChange={() => {}}
                        label={t('exportCenter.projectPart.work')}
                        hint={t('exportCenter.projectPartHint.work')}
                        size={projectSizes ? formatBytes(projectSizes.work) : ''}
                      />
                      {PROJECT_PARTS.map((part) => {
                        const none = projectSizes != null && projectSizes[part] == null;
                        return (
                          <PartToggle
                            key={part}
                            checked={s.project[part] && !none}
                            disabled={none}
                            onChange={(on) => patch('project', { [part]: on })}
                            label={t(`exportCenter.projectPart.${part}`)}
                            hint={none ? t('exportCenter.projectPartNone') : t(`exportCenter.projectPartHint.${part}`)}
                            size={!none && projectSizes ? formatBytes(projectSizes[part] ?? 0) : ''}
                          />
                        );
                      })}
                    </div>
                  </Field>
                  <Hint>{t('exportCenter.projectHint')}</Hint>
                </>
              )}

              {dest === 'images' && (
                <>
                  <Field label={t('exportCenter.poster')}>
                    <button
                      type="button"
                      onClick={exportPoster}
                      disabled={Boolean(working) || !totalMs || !folder}
                      className="inline-flex h-9 items-center gap-2 self-start rounded-lg border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Download size={14} />
                      {posterAt != null ? t('exportCenter.posterAt').replace('{time}', formatFilmTime(posterAt * 1000)) : t('exportCenter.posterMiddle')}
                    </button>
                  </Field>
                  <Field label={t('exportCenter.sceneStills')}>
                    <p className="-mt-1 mb-1 text-[12px] text-[var(--text-muted)]">
                      {t('exportCenter.sceneStillsDesc').replace('{n}', String(stillCount))}
                    </p>
                    <Segmented
                      value={s.images.format}
                      options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }]}
                      onChange={(format) => patch('images', { format })}
                    />
                  </Field>
                  <FrameField
                    value={s.images.frame}
                    fill={s.images.fill}
                    current={props.frame}
                    stage={stage}
                    onChange={(frame) => patch('images', { frame })}
                    onFill={(fill) => patch('images', { fill })}
                    t={t}
                  />
                  <Field label={t('exportCenter.resolution')}>
                    <Chips
                      value={s.images.shortEdge}
                      options={STILL_EDGES.map((p) => ({ value: p, label: p === 2160 ? '4K' : `${p}p` }))}
                      onChange={(shortEdge) => patch('images', { shortEdge })}
                    />
                  </Field>
                  {captions > 0 && (
                    <Toggle checked={s.images.burn} onChange={(burn) => patch('images', { burn })} label={t('exportCenter.burnIn')} />
                  )}
                </>
              )}

              {dest === 'slides' && (
                <>
                  <Field label={t('exportCenter.format')}>
                    <div className="grid grid-cols-2 gap-2">
                      {(['pptx', 'pdf'] as const).map((f) => (
                        <OptionCard
                          key={f}
                          on={s.slides.format === f}
                          title={f === 'pptx' ? 'PowerPoint' : 'PDF'}
                          desc={t(`exportCenter.slidesHint.${f}`)}
                          onClick={() => patch('slides', { format: f })}
                        />
                      ))}
                    </div>
                  </Field>
                  <FrameField
                    value={s.slides.frame}
                    fill={s.slides.fill}
                    current={props.frame}
                    stage={stage}
                    onChange={(frame) => patch('slides', { frame })}
                    onFill={(fill) => patch('slides', { fill })}
                    t={t}
                  />
                  {captions > 0 && (
                    <Toggle checked={s.slides.burn} onChange={(burn) => patch('slides', { burn })} label={t('exportCenter.burnIn')} />
                  )}
                </>
              )}

              {/* range: any destination with a picture or a sound over time can take a part */}
              {(dest === 'social' || dest === 'video' || dest === 'gif' || dest === 'audio' || dest === 'subtitles' || (dest === 'alpha' && !alphaBlock)) && totalMs > 0 && (
                <Field label={t('exportCenter.range')}>
                  <Segmented
                    value={range.on ? 'part' : 'all'}
                    options={[
                      { value: 'all', label: `${t('exportCenter.rangeAll')} · ${formatFilmTime(totalMs)}` },
                      { value: 'part', label: t('exportCenter.rangePart') },
                    ]}
                    onChange={(v) => setRange((r) => ({ ...r, on: v === 'part' }))}
                  />
                  {range.on && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      <div className="flex w-[220px] min-w-0">
                        <MenuSelect
                          label={t('exportCenter.rangeFrom')}
                          size="md"
                          value={String(range.from)}
                          groups={[{ choices: boundaries.starts.map((m) => ({ value: String(m.ms), label: [formatFilmTime(m.ms), m.title].filter(Boolean).join(' · ') })) }]}
                          onPick={(v) => {
                            const from = Number(v);
                            setRange((r) => ({ ...r, from, to: r.to > from ? r.to : (boundaries.ends.find((m) => m.ms > from)?.ms ?? totalMs) }));
                          }}
                        />
                      </div>
                      <span>→</span>
                      <div className="flex w-[220px] min-w-0">
                        <MenuSelect
                          label={t('exportCenter.rangeTo')}
                          size="md"
                          value={String(range.to)}
                          groups={[{ choices: boundaries.ends.filter((m) => m.ms > range.from).map((m) => ({ value: String(m.ms), label: [formatFilmTime(m.ms), m.title].filter(Boolean).join(' · ') })) }]}
                          onPick={(v) => setRange((r) => ({ ...r, to: Number(v) }))}
                        />
                      </div>
                      <span className="tabular-nums">{formatFilmTime(rangeMs)}</span>
                    </div>
                  )}
                </Field>
              )}
            </div>
          </div>

          {/* bottom: where it goes (the folder, a click changes it), what comes out, and the primary button */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-t border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] px-5 py-3.5">
            {toDrafts ? (
              <div className="-ml-2 flex min-w-0 max-w-[340px] flex-1 items-center gap-2.5 px-2 py-1.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--text-muted)] ring-1 ring-[var(--border)]">
                  <Clapperboard size={15} />
                </span>
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{t('exportCenter.saveTo')}</span>
                  <span className="truncate text-[13px] font-medium text-[var(--text)]">{tApp('exportCenter.nleDraftTitle')}</span>
                </span>
              </div>
            ) : folderDraft != null ? (
              <input
                autoFocus
                value={folderDraft}
                spellCheck={false}
                aria-label={t('exportCenter.saveTo')}
                onChange={(e) => setFolderDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commitFolder}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitFolder(); }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFolderDraft(null); }
                }}
                className="h-10 min-w-[200px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--text-faint)]"
              />
            ) : (
              <button
                type="button"
                onClick={() => void changeFolder()}
                disabled={picking}
                title={folder}
                aria-label={`${t('exportCenter.saveTo')}: ${folder || '—'}. ${t('exportCenter.change')}`}
                className="group -ml-2 flex min-w-0 max-w-[340px] flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--bg-hover)] disabled:opacity-60"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--text-muted)] ring-1 ring-[var(--border)] transition group-hover:text-[var(--text)]">
                  {picking ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{t('exportCenter.saveTo')}</span>
                    <span className="truncate text-[13px] font-medium text-[var(--text)]">{folderName(folder) || '—'}</span>
                  </span>
                  <span className="truncate text-[11px] text-[var(--text-faint)] group-hover:text-[var(--text-muted)]">{t('exportCenter.change')}</span>
                </span>
              </button>
            )}
            <div className="ml-auto flex min-w-0 items-center gap-4">
              <div className="min-w-0 text-right text-[12px] leading-snug">
                {result ? (
                  <span className={result.ok ? 'text-[var(--ok)]' : 'text-[var(--err)]'}>{result.text}</span>
                ) : emptyReason ? (
                  <span data-export-reason="" className={missingReason ? 'text-[var(--warn)]' : 'text-[var(--text-faint)]'}>{emptyReason}</span>
                ) : (
                  <>
                    {/* a project is not a length of film: its size only */}
                    {dest !== 'project' ? (
                      <span className="block text-[var(--text-muted)] tabular-nums">
                        {t('exportCenter.summary').replace('{n}', String(fileCount)).replace('{dur}', formatFilmTime(outMs))}
                      </span>
                    ) : null}
                    {estText ? <span className="block text-[11px] text-[var(--text-faint)] tabular-nums">{`${t('exportCenter.approx')} ${estText}`}</span> : null}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => void queue(requests)}
                disabled={disabled}
                className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-[var(--text)] px-6 text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {working ? <Loader2 size={14} className="animate-spin" /> : null}
                {primaryLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── small parts ────────────────────────────────────────────────────────── */

/** A folder's own name, the last part of its path (the whole path is the button's tooltip). */
function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{label}</span>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">{children}</p>;
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--warn)]" />
      <span>{children}</span>
    </div>
  );
}

function OptionCard({ on, disabled, title, desc, onClick }: {
  on: boolean; disabled?: boolean; title: string; desc: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
        on ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:border-[var(--text-faint)]'
      }`}
    >
      <span className="text-[12.5px] font-medium text-[var(--text)]">{title}</span>
      <span className="text-[11px] leading-snug text-[var(--text-faint)]">{desc}</span>
    </button>
  );
}

/**
 * A frame rate, from an editor's list: the film's own (or its footage's) is in it whatever it is, said beside its
 * number ("30 fps · project").
 */
function FpsSelect({ label, value, rates, own, onPick }: {
  label: string;
  value: number;
  rates: readonly number[];
  own: { fps: number; note: string } | null;
  onPick: (fps: number) => void;
}) {
  const all = [...new Set([...rates, ...(own ? [own.fps] : [])])].sort((a, b) => a - b);
  const name = (f: number) => `${f} fps${own && f === own.fps ? ` · ${own.note}` : ''}`;
  return (
    <MenuSelect
      size="md"
      label={label}
      value={String(value)}
      groups={[{ choices: all.map((f) => ({ value: String(f), label: name(f) })) }]}
      onPick={(v) => onPick(Number(v))}
    />
  );
}

function Chips<V extends string | number>({ value, options, onChange }: {
  value: V;
  options: readonly { value: V; label: string; sub?: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex min-w-[56px] flex-col items-center rounded-lg border px-2.5 py-1.5 transition ${
              on ? 'border-[var(--text)] bg-[var(--bg-hover)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-faint)]'
            }`}
          >
            <span className="text-[12.5px] font-medium tabular-nums">{o.label}</span>
            {o.sub ? <span className="text-[10px] tabular-nums text-[var(--text-faint)]">{o.sub}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Segmented<V extends string>({ value, options, onChange }: {
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    /* a capsule in a capsule: the same even gap all round, so their curves run side by side */
    <div className="inline-flex max-w-full self-start overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--bg)] p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-medium transition ${
            o.value === value ? 'bg-[var(--surface-3,var(--bg-hover))] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A switch and its words: lit when on, quieter when off, faint when it can't be had. `locked`: always on (a part that
 * is always taken), shown on in full, not to be switched.
 */
function Toggle({ checked, onChange, label, disabled, locked }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; locked?: boolean;
}) {
  const tone = disabled ? 'text-[var(--text-faint)]' : checked || locked ? 'text-[var(--text)]' : 'text-[var(--text-muted)]';
  return (
    <label className={`flex select-none items-center gap-2.5 text-[12.5px] ${tone} ${disabled || locked ? 'cursor-default' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked || Boolean(locked)}
        aria-readonly={locked || undefined}
        disabled={disabled}
        onClick={() => { if (!locked) onChange(!checked); }}
        className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition ${checked || locked ? 'bg-[var(--text)]' : 'bg-[var(--border-strong,var(--border))]'} ${locked ? 'cursor-default' : ''} disabled:opacity-50`}
      >
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[var(--bg)] transition-[left] ${checked || locked ? 'left-[14px]' : 'left-[2px]'}`} />
      </button>
      {label}
    </label>
  );
}

/** A part of the project to take or leave: the switch, what the part is, and how big. */
function PartToggle({ checked, onChange, label, hint, size, disabled, locked }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; size: string; disabled?: boolean; locked?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} locked={locked} />
        {size && <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--text-faint)]">{size}</span>}
      </div>
      <p className="pl-[40px] text-[11.5px] leading-snug text-[var(--text-faint)]">{hint}</p>
    </div>
  );
}

function QualityPicker({ value, onChange, t }: { value: ExportQuality; onChange: (q: ExportQuality) => void; t: (k: string) => string }) {
  return (
    <Segmented
      value={value}
      options={[
        { value: 'standard', label: t('exportCenter.qStandard') },
        { value: 'high', label: t('exportCenter.qHigh') },
        { value: 'master', label: t('exportCenter.qMaster') },
      ]}
      onChange={onChange}
    />
  );
}

/** A small glyph: the frame's shape, and inside it the film as it lands. */
function AspectGlyph({ frame, stage, fill = 'contain' }: { frame: FilmFrameId; stage: { w: number; h: number }; fill?: FilmFrameFill }) {
  const box = filmFrameBox(stage, frame, fill);
  const k = 14 / Math.max(box.w, box.h);
  const w = Math.max(6, box.w * k);
  const h = Math.max(6, box.h * k);
  return (
    <span className="relative inline-block shrink-0 overflow-hidden rounded-[2px] border border-[var(--text-faint)]" style={{ width: w, height: h }}>
      <span
        className="absolute bg-[var(--text-muted)] opacity-50"
        style={{
          left: box.inner.left * k,
          top: box.inner.top * k,
          width: box.inner.w * k,
          height: box.inner.h * k,
        }}
      />
    </span>
  );
}

function FrameField({ value, fill, current, stage, onChange, onFill, t }: {
  value: FrameChoice;
  fill: FilmFrameFill;
  current: FilmFrameId;
  stage: { w: number; h: number };
  onChange: (f: FrameChoice) => void;
  onFill: (f: FilmFrameFill) => void;
  t: (k: string) => string;
}) {
  const resolved = value === 'current' ? current : value;
  const differs = resolved !== 'native' && Math.abs(filmFrameRatio(resolved, stage) - stage.w / Math.max(1, stage.h)) > 0.01;
  return (
    <Field label={t('exportCenter.frame')}>
      <div className="flex flex-wrap gap-1.5">
        {[...FILM_FRAME_IDS, ...(FILM_FRAME_IDS.includes(resolved) ? [] : [resolved])].map((f) => {
          const on = resolved === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(f === current ? 'current' : f)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition ${
                on ? 'border-[var(--text)] bg-[var(--bg-hover)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-faint)]'
              }`}
            >
              <AspectGlyph frame={f} stage={stage} fill={fill} />
              {f === 'native' ? t('exportCenter.frameNative') : f}
            </button>
          );
        })}
        <CustomFrame chip value={resolved} onPick={(f) => onChange(f === current ? 'current' : f)} />
      </div>
      {differs && (
        <Segmented
          value={fill}
          options={[
            { value: 'contain', label: t('exportCenter.fillContain') },
            { value: 'cover', label: t('exportCenter.fillCover') },
          ]}
          onChange={onFill}
        />
      )}
    </Field>
  );
}
