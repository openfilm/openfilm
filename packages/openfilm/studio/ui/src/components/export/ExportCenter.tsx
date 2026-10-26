/**
 * The export center: the project menu's "Export".
 *
 * Video files share one page: Default and platform presets fill the same editable encoding settings. Other
 * destinations cover editing projects, transparent assets, GIFs, sound, stills and project files.
 *
 * Everything renders on this machine, in Studio's server (see lib/export-jobs): the dialog closes as soon as the
 * exports are queued, and the export tray follows them.
 *
 * What was chosen last time for each destination is kept in this browser (localStorage) and comes back next time.
 */
import {
  AlertTriangle, AudioLines, Captions, ChevronDown, Clapperboard, Film, FolderArchive, FolderOpen, Images, Layers, Loader2,
  Sparkles, X,
} from 'lucide-react';
import React from 'react';
import { createPortal } from 'react-dom';

import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { MenuSelect } from '@/components/MenuSelect';
import { CustomFrame } from '@/components/FramePicker';
import { FRAME_RATES } from '@/lib/timecode';
import { applyRangeDelivery, readExportRanges, requestDurationMs, type ExportRangeDraft, type RangeDelivery } from '@/lib/export-range';
import { api } from '@/api';
import { DEFAULT_VIDEO_EXPORT, legacySocialVideo, patchVideoExport, readVideoExport, videoExportPreset, type VideoExportSettings } from '@/lib/video-export-preset';
import {
  CODEC_LABEL,
  EXPORT_ALPHA_CODECS,
  exportPresetsFor,
  exportEstimateBytes,
  exportFilmPixels,
  exportFramedDims,
  exportGifDims,
  exportGifEstimateBytes,
  exportPreset,
  rangeMarks,
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
  type NleAlpha,
  type ProjectPart,
  type ProjectSizes,
} from '@/lib/export-jobs';
import { FILM_FRAME_IDS, filmFrameBox, filmFrameRatio, type FilmFrameFill, type FilmFrameId } from '@/lib/film-frame';
import { cleanMoments, loadSharedMoments, MOMENTS_MAX, momentSeconds, saveMoments } from '@/lib/export-moments';
import { MomentPicker } from './MomentPicker';
import { RangePicker } from './RangePicker';
import { LARGE_DIALOG, LARGE_DIALOG_BACKDROP } from '../dialog-chrome';

type Dest = 'video' | 'alpha' | 'nle' | 'gif' | 'audio' | 'subtitles' | 'images' | 'project';
type ImageOutput = 'files' | 'zip' | 'pdf' | 'pptx';
const IMAGE_OUTPUTS: readonly ImageOutput[] = ['files', 'zip', 'pdf', 'pptx'];

const DESTS: readonly { id: Dest; icon: React.ReactNode }[] = [
  { id: 'video', icon: <Film size={16} /> },
  { id: 'nle', icon: <Clapperboard size={16} /> },
  { id: 'alpha', icon: <Layers size={16} /> },
  { id: 'gif', icon: <Sparkles size={16} /> },
  { id: 'audio', icon: <AudioLines size={16} /> },
  { id: 'subtitles', icon: <Captions size={16} /> },
  { id: 'images', icon: <Images size={16} /> },
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
  video: VideoExportSettings;
  gif: { width: number; fps: number; frame: FrameChoice; fill: FilmFrameFill; burn: boolean };
  /** `source`: a block's clip id, or the whole film. */
  alpha: { codec: ExportVideoCodec; source: string; shortEdge: number; scale: number; fps: number; audio: boolean };
  audio: { format: 'wav' | 'm4a' | 'mp3'; mix: boolean; stems: boolean };
  /** For an editing program: the sound as clips or as mixed stems. */
  /** the app it is for: `draft` 剪映 (in Chinese) or CapCut (elsewhere), the same draft; `auto`: the draft when that app
      is on this computer, else Premiere Pro */
  nle: { app: 'auto' | 'draft' | keyof typeof NLE_APPS; fps: number | 'source'; audio: 'clips' | 'stems'; subtitles: boolean;
    /** How the pages are written: for a draft, and for Premiere Pro or DaVinci Resolve (Final Cut Pro takes ProRes). */
    alphaDraft: NleAlpha; alphaXml: NleAlpha };
  subtitles: { format: 'srt' | 'vtt' | 'txt' };
  images: { as: ImageOutput; format: 'png' | 'jpg'; shortEdge: number; frame: FrameChoice; fill: FilmFrameFill; burn: boolean };
  /** The project itself: a zip or a folder, and which parts besides its work (conversations and logs are private). */
  project: { as: 'zip' | 'folder' } & Record<ProjectPart, boolean>;
  /** Where exports are written. Empty = the default folder. */
  folder: string;
}

const DEFAULTS: Settings = {
  dest: 'video',
  video: { ...DEFAULT_VIDEO_EXPORT },
  gif: { width: 640, fps: 15, frame: 'current', fill: 'contain', burn: true },
  alpha: { codec: 'prores4444', source: WHOLE_FILM, shortEdge: 1080, scale: 1, fps: 30, audio: true },
  audio: { format: 'wav', mix: true, stems: false },
  nle: { app: 'auto', fps: 'source', audio: 'clips', subtitles: true, alphaDraft: 'auto', alphaXml: 'prores4444' },
  subtitles: { format: 'srt' },
  images: { as: 'files', format: 'png', shortEdge: 1080, frame: 'current', fill: 'contain', burn: false },
  project: { as: 'zip', history: false, chat: false, logs: false },
  folder: '',
};

const STORE_KEY = 'openfilm.exportCenter.v1';

/** Retain previous settings, including projects last exported from the former social-platform page. */
function loadSettings(language: string, projectFps: number): Settings {
  const first = DEFAULTS;
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as (Omit<Partial<Settings>, 'dest'> & {
      dest?: Dest | 'social' | 'slides';
      presets?: string[]; socialQuality?: ExportQuality; socialSubs?: 'auto' | 'on' | 'off';
      slides?: Omit<Settings['images'], 'as' | 'format'> & { format?: 'pdf' | 'pptx' };
    }) | null;
    if (!raw || typeof raw !== 'object') return first;
    const nle = { ...DEFAULTS.nle, ...raw.nle };
    if (nle.app !== 'auto' && nle.app !== 'draft' && !Object.hasOwn(NLE_APPS, nle.app)) nle.app = 'auto';
    const images = { ...DEFAULTS.images, ...raw.images };
    if (!IMAGE_OUTPUTS.includes(images.as)) images.as = 'files';
    if (raw.dest === 'slides') {
      const { format, ...framing } = raw.slides ?? {};
      Object.assign(images, framing, { as: format === 'pdf' ? 'pdf' : 'pptx' });
    }
    const offered = exportPresetsFor(language);
    const previousPlatform = Array.isArray(raw.presets)
      ? raw.presets.find((id) => offered.some((p) => p.id === id))
      : language === 'zh-CN' ? 'bilibili' : 'youtube';
    const video = raw.dest === 'social'
      ? legacySocialVideo(previousPlatform ?? 'default', raw.socialQuality, raw.socialSubs, projectFps)
      : readVideoExport(raw.video);
    if (exportPreset(video.preset) && !offered.some((p) => p.id === video.preset)) video.preset = 'custom';
    return {
      ...DEFAULTS,
      ...raw,
      dest: raw.dest === 'slides' ? 'images' : raw.dest === 'social' ? 'video' : raw.dest ?? DEFAULTS.dest,
      /* sound starts on each time: switched off for one export and kept, every later one came out silent unnoticed */
      video,
      gif: { ...DEFAULTS.gif, ...raw.gif },
      alpha: { ...DEFAULTS.alpha, ...raw.alpha, audio: true },
      audio: { ...DEFAULTS.audio, ...raw.audio },
      nle,
      subtitles: { ...DEFAULTS.subtitles, ...raw.subtitles },
      images,
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
/** The rates editors take; a source at another NTSC rate (23.976, 59.94) comes as the "source" choice. */
const NLE_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
/** How a draft and an XML write their pages (exports.mjs), the default first. */
const NLE_ALPHA: Record<'draft' | 'xml', readonly NleAlpha[]> = { draft: ['auto', 'png', 'prores'], xml: ['prores4444', 'png'] };
const NLE_ALPHA_NAME: Record<Exclude<NleAlpha, 'auto'>, string> = { png: 'PNG', prores: 'ProRes', prores4444: 'ProRes 4444' };
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
    /** Video clips not probed yet: the film is not known to be silent while there are any. */
    unprobed?: number;
  } | null;
  /** Where the playhead is: the image picked to begin with (the middle of the film without it). */
  playheadMs?: number;
  /** The markers on the film (ms): the images or slides can be one at each. */
  markersMs?: readonly number[];
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
const RENDERS: ReadonlySet<Dest> = new Set(['video', 'alpha', 'gif', 'audio', 'images']);

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
  const [range, setRange] = React.useState(false);
  const [rangeParts, setRangeParts] = React.useState<ExportRangeDraft[]>([]);
  const [rangeDelivery, setRangeDelivery] = React.useState<RangeDelivery>('separate');
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
  /** What the files are called, as typed here: the project's name to begin with, and when left empty. */
  const [exportName, setExportName] = React.useState<string>('');
  /** Whether that name was typed over: only then is it sent, so a dialog left alone exports as it always did. */
  const [nameTyped, setNameTyped] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const loaded = loadSettings(language, props.projectFps ?? 30);
    setS(props.focusClipId
      ? { ...loaded, dest: 'alpha', alpha: { ...loaded.alpha, source: props.focusClipId } }
      : loaded);
    setHydrated(true);
    setResult(null);
    setWorking(null);
    setFolderDraft(null);
    /* a name is this export's, not a setting: each visit starts from the project's own */
    setExportName(props.title);
    setNameTyped(false);
    setRange(false);
    void listExports(props.projectId).then((r) => { setCan(r.can); setDraftApps({ jianying: Boolean(r.drafts?.jianying), capcut: Boolean(r.drafts?.capcut) }); setDefaultFolder(r.folder); setCaptionCount(r.subtitles ?? 0); setProjectSizes(r.project ?? null); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (hydrated) saveSettings(s);
  }, [s, hydrated]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !working) onClose(); };
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
  /* silent only when every video's file said it has no sound: one not probed yet (or that failed to be) may have */
  const knownSilent = film != null && soundKinds.size === 0 && !film.unprobed;

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

  /* Clip edges remain shortcuts; the time fields can name any point in the film. */
  const boundaries = React.useMemo(() => rangeMarks(film?.scenes ?? [], totalMs), [film, totalMs]);
  React.useEffect(() => {
    setRangeParts([{ id: 'initial', from: '0', to: String(Math.min(3000, totalMs) / 1000) }]);
  }, [totalMs, props.projectId]);

  const projectFps = props.projectFps ?? 30;
  const parsedRanges = readExportRanges(rangeParts, totalMs, projectFps);
  const rangeMs = range && parsedRanges ? parsedRanges.reduce((n, [from, to]) => n + (to - from) * 1000, 0) : totalMs;

  const resolveFrame = (f: FrameChoice): FilmFrameId => (f === 'current' ? props.frame : f);
  /* 'source' is the project's own rate */
  const fpsFor = (f: number | 'source'): number => (f === 'source' ? projectFps : f);

  /* All four deliveries share the same picks. Read the old separate lists on first use, without losing a selection. */
  const [moments, setMoments] = React.useState<number[]>([]);
  React.useEffect(() => {
    if (!open || !(totalMs > 0)) return;
    const output = loadSettings(language, projectFps).images.as;
    const previous = output === 'pdf' || output === 'pptx' ? 'slides' : 'images';
    const list = cleanMoments(loadSharedMoments(props.projectId, previous) ?? [], totalMs, projectFps, MOMENTS_MAX.frames);
    setMoments(list);
    saveMoments(props.projectId, 'frames', list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, props.projectId, totalMs > 0]);
  const pickMoments = (list: number[]) => {
    setMoments(list);
    saveMoments(props.projectId, 'frames', list);
  };

  const patch = <K extends keyof Settings>(key: K, value: Partial<Settings[K]> | Settings[K]) => {
    setS((prev) => key === 'video' ? { ...prev, video: patchVideoExport(prev.video, value as Partial<VideoExportSettings>) } : ({
      ...prev,
      [key]: typeof value === 'object' && !Array.isArray(value) && value !== null
        ? { ...(prev[key] as object), ...(value as object) }
        : value,
    }));
  };

  const dest: Dest = DESTS.some((d) => d.id === s.dest) ? s.dest : 'video';
  const imageDocument = s.images.as === 'pdf' || s.images.as === 'pptx';
  const alphaBlock = blocks.find((b) => b.clipId === s.alpha.source);
  const canRange = totalMs > 0 && (dest === 'video' || dest === 'gif' || dest === 'audio' || dest === 'subtitles' || (dest === 'alpha' && !alphaBlock));
  const rangeInvalid = canRange && range && !parsedRanges;
  const rangeError = rangeParts.length ? t('exportCenter.rangeInvalid').replace('{end}', String(totalMs / 1000)) : t('exportCenter.rangePickOne');
  /* how long what comes out is: one element alone is its own length, not the film's */
  const outMs = dest === 'alpha' && alphaBlock ? alphaBlock.durMs : rangeMs;
  const selectedVideoPreset = exportPreset(s.video.preset);
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
  /* Final Cut Pro takes ProRes only: no choice */
  const nleAlphaKind = nleApp === 'draft' ? 'draft' : nleApp === 'finalcut' ? null : 'xml';
  const nleAlphaPicked = nleAlphaKind === 'draft' ? s.nle.alphaDraft : s.nle.alphaXml;
  const nleAlpha: NleAlpha = !nleAlphaKind ? 'prores4444'
    : NLE_ALPHA[nleAlphaKind].includes(nleAlphaPicked) && (!nleAlphaPicked.startsWith('prores') || codecAvailable('prores4444', can)) ? nleAlphaPicked : NLE_ALPHA[nleAlphaKind][0];
  const codecName = (c: ExportVideoCodec) => CODEC_LABEL[c] + (c === 'png' ? ` ${t('exportCenter.sequence')}` : '');

  /* the parts of the project asked that it has (a part it has none of is left out) */
  const projectParts = React.useMemo(
    () => PROJECT_PARTS.filter((part) => s.project[part] && (projectSizes == null || projectSizes[part] != null)),
    [s.project, projectSizes],
  );

  /* ── the exports this screen asks for ── */
  const baseRequests = React.useMemo((): ExportRequest[] => {
    /* subtitles drawn into the picture: only a film that has some */
    const burn = (on: boolean) => (captions > 0 && on ? { burnSubtitles: true } : {});
    switch (dest) {
      case 'video': {
        const v = s.video;
        return [{
          kind: 'video', codec: videoCodec, frame: resolveFrame(v.frame), fill: v.fill, shortEdge: v.shortEdge, fps: fpsFor(v.fps),
          quality: v.quality, audio: v.audio, label: selectedVideoPreset?.name ?? codecName(videoCodec), ...burn(v.burn),
          ...(selectedVideoPreset ? { preset: selectedVideoPreset.name } : {}),
          ...(captions > 0 && v.sidecar !== 'none' && videoCodec !== 'png' ? { sidecar: v.sidecar } : {}),
        }];
      }
      case 'alpha': {
        const a = s.alpha;
        return alphaBlock
          ? [{ kind: 'video', codec: alphaCodec, clip: alphaBlock.clipId, scale: a.scale, fps: a.fps, quality: 'high', audio: a.audio, label: alphaBlock.label }]
          : [{ kind: 'video', codec: alphaCodec, frame: 'native', shortEdge: a.shortEdge, fps: a.fps, quality: 'high', audio: a.audio, label: codecName(alphaCodec) }];
      }
      case 'gif':
        return [{ kind: 'gif', frame: resolveFrame(s.gif.frame), fill: s.gif.fill, width: s.gif.width, fps: s.gif.fps, label: 'GIF', ...burn(s.gif.burn) }];
      case 'audio': {
        const stems = s.audio.stems;
        return [{ kind: 'audio', format: audioFormat, stems, mix: stems ? s.audio.mix : true, label: t(stems ? 'exportCenter.audioStems' : 'exportCenter.audioMix') }];
      }
      case 'nle':
        return [{
          kind: 'nle', format: nleApp === 'draft' ? draftApp : NLE_APPS[nleApp].format, fps: s.nle.fps === 'source' ? (nleSourceFps ?? projectFps) : s.nle.fps, audio: s.nle.audio, media: 'copy', alpha: nleAlpha,
          subtitles: s.nle.subtitles, label: nleApp === 'draft' ? tApp('exportCenter.nleDraftTitle') : `${NLE_APPS[nleApp].name} XML`,
        }];
      case 'subtitles':
        return [{ kind: 'subtitles', format: s.subtitles.format, label: s.subtitles.format === 'txt' ? t('exportCenter.transcript') : s.subtitles.format.toUpperCase() }];
      case 'images': {
        const at = momentSeconds(moments);
        if (!at.length) return [];
        const framing = { shortEdge: s.images.shortEdge, frame: resolveFrame(s.images.frame), fill: s.images.fill, at, ...burn(s.images.burn) };
        return s.images.as === 'pdf' || s.images.as === 'pptx'
          ? [{ kind: 'slides', format: s.images.as, ...framing, label: s.images.as.toUpperCase() }]
          : [{ kind: 'stills', as: s.images.as, format: s.images.format, ...framing, label: t('exportCenter.summaryImages').replace('{n}', String(at.length)) }];
      }
      case 'project':
        return [{
          kind: 'project', as: s.project.as, parts: projectParts,
          label: t(s.project.as === 'zip' ? 'exportCenter.projectZip' : 'exportCenter.projectFolder'),
        }];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest, s, can, nleApp, nleAlpha, draftApp, props.frame, blocks, nleSourceFps, captions, projectParts, moments]);

  const requests = React.useMemo(() => canRange && range && parsedRanges
    ? applyRangeDelivery(baseRequests, parsedRanges, rangeDelivery) : baseRequests,
  [baseRequests, canRange, range, parsedRanges, rangeDelivery]);

  /* a range, not a size: what is in the picture decides a video's or a GIF's size (export-spec.ts); sound is exact */
  const estBytes = React.useMemo(() => requests.reduce<[number, number]>(([low, high], r) => {
    const add = ([a, b]: readonly [number, number]): [number, number] => [low + a, high + b];
    if (r.kind === 'video') {
      /* one block's size depends on the block: not guessed */
      if (r.clip) return [low, high];
      const frame = r.frame ?? 'native', fill = r.fill ?? 'contain';
      const size = exportFramedDims(stage, frame, fill, r.shortEdge ?? Math.min(stage.w, stage.h));
      return add(exportEstimateBytes({
        codec: r.codec, size, filmPixels: exportFilmPixels(stage, frame, fill, size), fps: r.fps, quality: r.quality, durationMs: requestDurationMs(r, totalMs),
        audio: r.audio && r.codec !== 'png' && !knownSilent,
      }));
    }
    if (r.kind === 'gif') {
      const frame = r.frame ?? 'native', fill = r.fill ?? 'contain';
      const size = exportGifDims(filmFrameBox(stage, frame, fill), r.width);
      return add(exportGifEstimateBytes({ size, filmPixels: exportFilmPixels(stage, frame, fill, size), fps: r.fps, durationMs: requestDurationMs(r, totalMs) }));
    }
    if (r.kind === 'audio') {
      /* 48 kHz 16-bit stereo; AAC and MP3 at 256k (exports.mjs SOUND_CODECS) */
      const per = r.format === 'wav' ? 192_000 : 32_000;
      const files = (r.mix ? 1 : 0) + (r.stems ? soundKinds.size : 0);
      const bytes = per * (requestDurationMs(r, totalMs) / 1000) * Math.max(1, files);
      return add([bytes, bytes]);
    }
    if (r.kind === 'project' && projectSizes) {
      const bytes = r.parts.reduce((n, part) => n + (projectSizes[part] ?? 0), projectSizes.work);
      return add([bytes, bytes]);
    }
    return [low, high];
  }, [0, 0]), [requests, stage, totalMs, soundKinds, knownSilent, projectSizes]);
  /* "about 0.8 MB–8 MB"; one size when both ends read the same */
  const estText = estBytes[1] > 0 ? [...new Set(estBytes.map((b) => formatBytes(b)))].join('–') : '';

  const folder = s.folder || defaultFolder;

  const fileCount = requests.reduce((n, r) => {
    if (r.kind === 'stills' && r.as === 'files') return n + (r.at?.length ?? 1);
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
    if (rangeInvalid) return rangeError;
    if (dest === 'images' && moments.length === 0) return t('exportCenter.pickMoments');
    if (dest === 'images' && imageDocument && moments.length > MOMENTS_MAX.slides) return t('exportCenter.imagePageLimit').replace('{n}', String(MOMENTS_MAX.slides));
    if (dest === 'subtitles' && captionCount != null && captions === 0) return t('exportCenter.noCaptions');
    if (dest === 'audio' && knownSilent) return t('exportCenter.noAudio');
    return null;
  })();

  /* ── doing it ── */
  const queue = async (jobs: ExportRequest[]) => {
    if (working || rangeInvalid) return;
    setResult(null);
    if (!folder) {
      setResult({ ok: false, text: t('exportCenter.noFolder') });
      return;
    }
    setWorking(t('exportCenter.queueing'));
    try {
      /* the name typed here, unless there is none or its field is hidden (a draft is named by its app): every way out
         of this screen comes through here */
      const typed = nameTyped && !toDrafts ? exportName.trim() : '';
      const named = typed ? jobs.map((job, index) => ({ ...job, name: typed + (canRange && range && rangeDelivery === 'separate' && (parsedRanges?.length ?? 0) > 1 ? ` - ${String(index + 1).padStart(2, '0')}` : '') })) : jobs;
      const queued = await startExports(props.projectId, named, s.folder || undefined);
      props.onQueued?.(queued);
      onClose();
    } catch (e) {
      setResult({ ok: false, text: e instanceof TypeError ? t('exportCenter.engineDown') : (e instanceof Error ? e.message : String(e)) });
    } finally {
      setWorking(null);
    }
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
      /* a plain dim, no backdrop blur: a blur over the whole window is drawn again on every frame of a wheel scroll in
         the dialog, and the window flickered on macOS */
      className={LARGE_DIALOG_BACKDROP}
      onClick={() => { if (!working) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('exportCenter.title')}
        className={LARGE_DIALOG}
        style={{ animation: 'openfilm-rise 0.16s ease-out both' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* left: destinations */}
        {/* the list scrolls when the window is short; the note under it stays whole */}
        <nav className="flex min-h-0 w-[212px] shrink-0 flex-col border-r border-[var(--border-soft)] bg-[var(--surface-2)]">
          <h2 className="shrink-0 px-5 pb-2 pt-4 text-[15px] font-semibold tracking-tight text-[var(--text)]">{t('exportCenter.title')}</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pb-2">
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

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-3">
            <div className="flex flex-col gap-5">
              {dest === 'video' && (
                <>
                  <Field label={t('exportCenter.videoPreset')}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="inline-flex w-fit min-w-[128px] max-w-full">
                        <MenuSelect
                          className="max-w-[280px]"
                          menuWidth="content"
                          label={t('exportCenter.videoPreset')}
                          value={s.video.preset}
                          size="md"
                          groups={[
                            { choices: [{ value: 'default', label: t('exportCenter.presetDefault') }] },
                            { label: t('exportCenter.platformPresets'), choices: presets.map((p) => ({ value: p.id, label: `${p.name} · ${p.frame}` })) },
                            ...(s.video.preset === 'custom' ? [{ choices: [{ value: 'custom', label: t('exportCenter.presetCustom') }] }] : []),
                          ]}
                          onPick={(id) => { if (id !== 'custom') patch('video', videoExportPreset(id, projectFps)); }}
                        />
                      </div>
                      <span className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                        {s.video.preset === 'custom' ? t('exportCenter.presetCustomHint') : selectedVideoPreset
                          ? `${selectedVideoPreset.frame} · ${s.video.shortEdge === 2160 ? '4K' : `${s.video.shortEdge}p`} · ${fpsFor(s.video.fps)} fps`
                          : t('exportCenter.presetDefaultHint')}
                      </span>
                    </div>
                    {selectedVideoPreset?.maxDurationSec != null && rangeMs / 1000 > selectedVideoPreset.maxDurationSec ? <p className="mt-2 text-[11px] text-[var(--warn)]">{t('exportCenter.tooLong').replace('{max}', formatFilmTime(selectedVideoPreset.maxDurationSec * 1000))}</p> : null}
                  </Field>
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
                  <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
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
                    <div className="flex max-h-[200px] flex-col gap-1.5 overflow-y-auto overscroll-contain pr-1">
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
                  {nleAlphaKind && (
                    <Field label={t('exportCenter.nleAlpha')}>
                      <div className="grid grid-cols-2 gap-2">
                        {NLE_ALPHA[nleAlphaKind].map((c) => {
                          const unavailable = c.startsWith('prores') && !codecAvailable('prores4444', can);
                          return (
                            <OptionCard
                              key={c}
                              on={nleAlpha === c}
                              disabled={unavailable}
                              title={c === 'auto' ? t('exportCenter.nleAlphaAuto') : NLE_ALPHA_NAME[c]}
                              desc={unavailable ? t('exportCenter.notOnThisComputer') : t(`exportCenter.nleAlphaHint.${c}`)}
                              onClick={() => patch('nle', nleAlphaKind === 'draft' ? { alphaDraft: c } : { alphaXml: c })}
                            />
                          );
                        })}
                      </div>
                    </Field>
                  )}
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

              {/* One set of frames, delivered as picture files, a zip, PDF or PPTX. */}
              {dest === 'images' && (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_272px]">
                  <MomentPicker
                    projectId={props.projectId}
                    totalMs={totalMs}
                    fps={projectFps}
                    stage={stage}
                    frame={resolveFrame(s.images.frame)}
                    fill={s.images.fill}
                    scenes={film?.scenes ?? []}
                    markersMs={props.markersMs ?? []}
                    playheadMs={props.playheadMs}
                    value={moments}
                    onChange={pickMoments}
                    max={imageDocument ? MOMENTS_MAX.slides : MOMENTS_MAX.frames}
                    note={captions > 0 && s.images.burn ? t('exportCenter.moments.noSubtitles') : undefined}
                  />
                  <div className="flex min-w-0 flex-col gap-5">
                    <Field label={t('exportCenter.imageOutput')}>
                      <div className="grid grid-cols-2 gap-2">
                        {IMAGE_OUTPUTS.map((output) => (
                          <OptionCard
                            key={output}
                            on={s.images.as === output}
                            title={output === 'files' ? t('exportCenter.imageFiles') : output.toUpperCase()}
                            desc={t(output === 'files' ? 'exportCenter.imageFilesHint' : output === 'zip' ? 'exportCenter.imageZipHint' : `exportCenter.slidesHint.${output}`)}
                            onClick={() => patch('images', { as: output })}
                          />
                        ))}
                      </div>
                    </Field>
                    {!imageDocument && (
                      <Field label={t('exportCenter.imageFormat')}>
                        <Segmented
                          value={s.images.format}
                          options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }]}
                          onChange={(format) => patch('images', { format })}
                        />
                      </Field>
                    )}
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
                  </div>
                </div>
              )}

              {/* range: any destination with a picture or a sound over time can take a part */}
              {canRange && (
                <Field label={t('exportCenter.range')}>
                  <Segmented
                    value={range ? 'part' : 'all'}
                    options={[
                      { value: 'all', label: `${t('exportCenter.rangeAll')} · ${formatFilmTime(totalMs)}` },
                      { value: 'part', label: t('exportCenter.rangePart') },
                    ]}
                    onChange={(v) => setRange(v === 'part')}
                  />
                  {range && (
                    <RangePicker
                      projectId={props.projectId}
                      totalMs={totalMs}
                      fps={projectFps}
                      stage={stage}
                      boundaries={boundaries}
                      value={rangeParts}
                      onChange={setRangeParts}
                      delivery={rangeDelivery}
                      onDelivery={setRangeDelivery}
                      error={rangeInvalid ? rangeError : null}
                    />
                  )}
                </Field>
              )}
            </div>
          </div>

          {/* bottom: where it goes (a button like the dialog's other pickers: a click picks another folder), what it is
              called, what comes out, and the primary button */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 border-t border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] px-5 py-3.5">
            <div className="flex min-w-[280px] max-w-[560px] flex-1 items-center gap-2">
              {toDrafts ? (
                <span className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-[13px] text-[var(--text-muted)]">
                  <Clapperboard size={15} className="shrink-0" />
                  <span className="truncate">{tApp('exportCenter.nleDraftTitle')}</span>
                </span>
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
                  className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--text-faint)]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => void changeFolder()}
                  disabled={picking}
                  title={folder}
                  aria-label={`${t('exportCenter.saveTo')}: ${folder || '—'}. ${t('exportCenter.change')}`}
                  className="flex h-10 min-w-0 max-w-[45%] shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--fill-tsp)] pl-3 pr-2.5 text-[13px] text-[var(--text)] outline-none transition hover:border-[var(--text-faint)] hover:bg-[var(--bg-hover)] focus-visible:border-[var(--accent)] disabled:opacity-60"
                >
                  {picking ? <Loader2 size={15} className="shrink-0 animate-spin text-[var(--text-muted)]" /> : <FolderOpen size={15} className="shrink-0 text-[var(--text-muted)]" />}
                  <span className="min-w-0 truncate">{folderName(folder) || '—'}</span>
                  <ChevronDown size={12} aria-hidden className="shrink-0 text-[var(--text-faint)]" />
                </button>
              )}
              {/* what the files are called: the project's own name unless typed over (a draft is named by its app) */}
              {!toDrafts && folderDraft == null && (
                <input
                  value={exportName}
                  spellCheck={false}
                  placeholder={props.title}
                  aria-label={t('exportCenter.fileName')}
                  title={t('exportCenter.fileName')}
                  onChange={(e) => { setExportName(e.target.value); setNameTyped(true); }}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && !disabled) { e.preventDefault(); void queue(requests); }
                  }}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-[13px] text-[var(--text)] outline-none transition focus:border-[var(--text-faint)]"
                />
              )}
            </div>
            <div className="ml-auto flex min-w-0 items-center gap-4">
              <div className="min-w-0 text-right text-[12px] leading-snug">
                {result ? (
                  <span className={result.ok ? 'text-[var(--ok)]' : 'text-[var(--err)]'}>{result.text}</span>
                ) : emptyReason ? (
                  <span data-export-reason="" className={missingReason ? 'text-[var(--warn)]' : 'text-[var(--text-faint)]'}>{emptyReason}</span>
                ) : (
                  <>
                    {/* a project is not a length of film: its size only */}
                    {/* pictures are counted, not timed */}
                    {dest === 'images' ? (
                      <span className="block text-[var(--text-muted)] tabular-nums">{momentsSummary(s.images.as, moments.length, t)}</span>
                    ) : dest !== 'project' ? (
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

/** What the picked moments come out as: one picture, pictures in a zip, or pages. */
function momentsSummary(output: ImageOutput, n: number, t: (k: string) => string): string {
  if (output === 'pdf' || output === 'pptx') return `${output.toUpperCase()} · ${t(n === 1 ? 'exportCenter.summarySlide' : 'exportCenter.summarySlides').replace('{n}', String(n))}`;
  return t(output === 'zip' ? 'exportCenter.summaryImagesZip' : n === 1 ? 'exportCenter.summaryImage' : 'exportCenter.summaryImages').replace('{n}', String(n));
}

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
    <div className="inline-flex w-fit min-w-[132px] max-w-full">
      <MenuSelect
        size="md"
        className="max-w-[180px]"
        label={label}
        value={String(value)}
        groups={[{ choices: all.map((f) => ({ value: String(f), label: name(f) })) }]}
        onPick={(v) => onPick(Number(v))}
      />
    </div>
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
