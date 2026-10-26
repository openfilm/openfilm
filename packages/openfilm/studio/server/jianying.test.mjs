import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { planNleTimeline } from './nle.mjs';
import { draftsRoot, jianyingDraft } from './jianying.mjs';

const facts = { w: 960, h: 540, duration: 10, hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000 };
const sound = { duration: 20, hasVideo: false, hasAudio: true, channels: 2, sampleRate: 48000 };

/** A film: a page over footage placed small, its own sound, music fading in on a muted track's neighbour, a still. */
const plan = (/** @type {Partial<{ musicOn: boolean }>} */ o = {}) => planNleTimeline({
  stage: { w: 1920, h: 1080 }, duration: 6,
  pictures: [
    { id: 'title', kind: 'page', src: 'title.html', path: '/p/title.html', at: 0, end: 2, from: 0, speed: 1, track: 0, hidden: false, facts: null },
    { id: 'shot', kind: 'video', src: 'a.mp4', path: '/p/a.mp4', at: 1, end: 5, from: 2, speed: 1, track: 1, hidden: false, box: { x: 480, y: 0, w: 960 }, facts },
    { id: 'still', kind: 'still', src: 'b.png', path: '/p/b.png', at: 5, end: 6, from: 0, speed: 1, track: 1, hidden: true, facts: { w: 1920, h: 1080 } },
  ],
  sounds: [
    { id: 'shot', src: 'a.mp4', path: '/p/a.mp4', at: 1, from: 2, to: 6, speed: 1, volume: 0.5, enabled: true, role: 'footage', picture: 'shot', facts },
    { id: 'bed', src: 'assets/audio/music/bed.wav', path: '/p/bed.wav', at: 0, from: 0, to: 6, speed: 1, volume: 0.8, enabled: o.musicOn ?? true, role: 'music', facts: sound, fade: [1, 0] },
  ],
}, { title: 'Film', fps: 30, audio: 'clips', media: 'copy', mediaDir: '/drafts/Film/media' });

test('a 剪映 draft: microseconds edge by edge, the plan\'s tracks, bottom first, as 剪映 stacks them', () => {
  const { info, meta } = jianyingDraft(plan(), { name: 'Film', folder: '/drafts/Film', root: '/drafts', now: 1_700_000_000_000 });
  assert.deepEqual(info.canvas_config, { width: 1920, height: 1080, ratio: 'original' });
  assert.equal(info.fps, 30);
  assert.equal(info.duration, 6_000_000);
  assert.deepEqual(info.tracks.map((t) => t.type), ['video', 'video', 'audio']);
  /* the film's second track is under its first: 剪映's first video track is the bottom one */
  const [bottom, top] = info.tracks;
  assert.deepEqual(bottom.segments.map((s) => s.target_timerange), [{ start: 1_000_000, duration: 4_000_000 }, { start: 5_000_000, duration: 1_000_000 }]);
  assert.deepEqual(top.segments[0].target_timerange, { start: 0, duration: 2_000_000 });
  /* footage from its second 2 */
  assert.deepEqual(bottom.segments[0].source_timerange, { start: 2_000_000, duration: 4_000_000 });
  assert.equal(meta.draft_name, 'Film');
  assert.equal(meta.draft_fold_path, '/drafts/Film');
  assert.equal(meta.draft_root_path, '/drafts');
  assert.equal(meta.draft_id, info.id);
  assert.equal(meta.tm_duration, 6_000_000);
});

test('placement: fitted in the canvas, then the plan\'s scale; moved in half-canvas units, y upward', () => {
  const { info } = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d' });
  const shot = info.tracks[0].segments[0];
  /* 960 × 540 at its own size is half of a 1920 × 1080 canvas it would fill: scale 0.5; its middle a quarter up */
  assert.deepEqual(shot.clip.scale, { x: 0.5, y: 0.5 });
  assert.deepEqual(shot.clip.transform, { x: 0, y: 0.5 });
  /* the page fills the canvas as it is */
  assert.deepEqual(info.tracks[1].segments[0].clip.scale, { x: 1, y: 1 });
  const still = info.tracks[0].segments[1];
  assert.equal(still.visible, false, 'a hidden track\'s clip comes hidden');
  const photo = info.materials.videos.find((m) => m.id === still.material_id);
  assert.equal(photo.type, 'photo');
  assert.deepEqual(still.source_timerange, { start: 0, duration: 1_000_000 });
});

test('footage plays its own sound at its level; other sounds are audio clips with 剪映\'s fades', () => {
  const { info } = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d' });
  const shot = info.tracks[0].segments[0];
  assert.equal(shot.volume, 0.5);
  const audio = info.tracks.filter((t) => t.type === 'audio');
  assert.equal(audio.length, 1, 'the footage\'s sound is not a second clip');
  const bed = audio[0].segments[0];
  assert.equal(bed.volume, 0.8);
  const fade = info.materials.audio_fades.find((f) => bed.extra_material_refs.includes(f.id));
  assert.equal(fade.fade_in_duration, 1_000_000);
  assert.equal(fade.fade_out_duration, 0);
  for (const s of info.tracks.flatMap((t) => t.segments)) {
    assert.ok(s.extra_material_refs.some((id) => info.materials.speeds.some((m) => m.id === id)), 'each clip has its speed');
  }
  /* each file one material */
  assert.equal(new Set(info.materials.videos.map((m) => m.path)).size, info.materials.videos.length);
  const silent = jianyingDraft(plan({ musicOn: false }), { name: 'Film', folder: '/d/Film', root: '/d' });
  assert.equal(silent.info.tracks.find((t) => t.type === 'audio').segments[0].volume, 0, 'a sound not heard comes silent');
});

test('subtitles: the app\'s own subtitle track over all, one subtitle a cue, white with a dark edge, low in the picture', () => {
  const { info } = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d', now: 1, cues: [{ text: '你好 world', startMs: 500, durMs: 1500 }, { text: ' ', startMs: 2000, durMs: 500 }] });
  const text = info.tracks.at(-1);
  assert.equal(text.type, 'text');
  /* as the app keeps the subtitles it recognizes: a subtitle track, its lines of one subtitle task, in their language */
  assert.equal(text.flag, 1);
  const [line] = info.materials.texts;
  assert.equal(line.type, 'subtitle');
  assert.equal(line.recognize_text, '你好 world');
  assert.equal(line.language, 'zh-CN');
  assert.deepEqual(info.config.subtitle_taskinfo.map((t) => [t.id, t.type, t.language]), [[line.recognize_task_id, 10, 'zh-CN']]);
  assert.equal(text.segments.length, 1, 'an empty cue is left out');
  assert.deepEqual(text.segments[0].target_timerange, { start: 500_000, duration: 1_500_000 });
  assert.equal(text.segments[0].clip.transform.y, -0.8);
  const content = JSON.parse(info.materials.texts[0].content);
  assert.equal(content.text, '你好 world');
  assert.deepEqual(content.styles[0].range, [0, 8]);
  assert.deepEqual(content.styles[0].strokes[0].content.solid.color, [0, 0, 0]);
});

test('the drafts folders: 剪映\'s and CapCut\'s, on a Mac and on Windows, when they are there', () => {
  const mac = (app) => join('/mac-home', 'Movies', app, 'User Data', 'Projects', 'com.lveditor.draft');
  assert.equal(draftsRoot('jianying', { platform: 'darwin', home: '/mac-home', exists: (p) => p === mac('JianyingPro') }), mac('JianyingPro'));
  assert.equal(draftsRoot('capcut', { platform: 'darwin', home: '/mac-home', exists: (p) => p === mac('CapCut') }), mac('CapCut'));
  assert.equal(draftsRoot('capcut', { platform: 'darwin', home: '/mac-home', exists: (p) => p === mac('JianyingPro') }), null);
  const win = join('D:\\local-app-data', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
  assert.equal(draftsRoot('jianying', { platform: 'win32', home: 'D:\\win-home', localAppData: 'D:\\local-app-data', exists: (p) => p === win }), win);
  assert.equal(draftsRoot('jianying', { platform: 'linux', home: '/linux-home', exists: () => true }), null);
  /* moved in the app's Settings › Drafts location: that folder, the default one no longer looked in */
  const settings = join('/mac-home', 'Movies', 'JianyingPro', 'User Data', 'Config', 'globalSetting');
  const read = (p) => { if (p !== settings) throw new Error('ENOENT'); return 'currentCachePath=/x\r\ncurrentCustomDraftPath=/Volumes/Work/剪映草稿\r\nother=1\r\n'; };
  assert.equal(draftsRoot('jianying', { platform: 'darwin', home: '/mac-home', read, exists: (p) => p === '/Volumes/Work/剪映草稿' || p === mac('JianyingPro') }), '/Volumes/Work/剪映草稿');
  /* a folder it names that is gone (a drive not plugged in): the default one, if it is there */
  assert.equal(draftsRoot('jianying', { platform: 'darwin', home: '/mac-home', read, exists: (p) => p === mac('JianyingPro') }), mac('JianyingPro'));
});

test('custom drafts folders: Qt quotes and escapes are decoded for both apps on Mac and Windows', async (t) => {
  const cases = [
    { name: 'quoted punctuation', value: '"/drafts/Film, cut; take=2"', path: '/drafts/Film, cut; take=2' },
    { name: 'escaped backslashes', value: String.raw`D:\\Film Cuts\\Drafts`, path: String.raw`D:\Film Cuts\Drafts` },
    { name: 'escaped Unicode', value: String.raw`/drafts/\x8349\x7a3f\xd83c\xdfac`, path: '/drafts/草稿🎬' },
    { name: 'escaped quotes', value: String.raw`"/drafts/Film \"One\""`, path: '/drafts/Film "One"' },
  ];
  for (const app of ['jianying', 'capcut']) {
    for (const platform of ['darwin', 'win32']) {
      for (const { name, value, path } of cases) {
        await t.test(`${app} on ${platform}: ${name}`, () => {
          const got = draftsRoot(app, {
            platform, home: '/draft-home', localAppData: '/local-app-data',
            read: () => `[General]\ncurrentCustomDraftPath=${value}\n`,
            exists: (p) => p === path || p.endsWith('com.lveditor.draft'),
          });
          assert.equal(got, path, 'the custom folder takes precedence over the default');
        });
      }
    }
  }
});

test('custom drafts folders: read the General section, allowing whitespace and CRLF', () => {
  const read = () => '\ufeff[Other]\r\ncurrentCustomDraftPath=/wrong\r\n[General]\r\n; currentCustomDraftPath=/comment\r\n  currentCustomDraftPath = "/drafts/Film Cuts"  \r\n[Later]\r\ncurrentCustomDraftPath=/later\r\n';
  assert.equal(draftsRoot('jianying', { platform: 'darwin', home: '/draft-home', read, exists: () => true }), '/drafts/Film Cuts');
  assert.equal(draftsRoot('capcut', {
    platform: 'darwin', home: '/draft-home', read: () => '[Other]\ncurrentCustomDraftPath=/wrong\n',
    exists: () => true,
  }), join('/draft-home', 'Movies', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft'));
});

test('custom drafts folders: empty or missing decoded paths fall back to an existing default', () => {
  const fallback = join('/draft-home', 'Movies', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
  for (const value of ['', '""', '"/disconnected/Drafts"']) {
    const where = { platform: 'darwin', home: '/draft-home', read: () => `[General]\ncurrentCustomDraftPath=${value}\n` };
    assert.equal(draftsRoot('jianying', { ...where, exists: (p) => p === fallback }), fallback);
    assert.equal(draftsRoot('jianying', { ...where, exists: () => false }), null);
  }
});

test('a draft says which app wrote it: 剪映 or CapCut', () => {
  const jy = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d' }).info;
  const cc = jianyingDraft(plan(), { app: 'capcut', name: 'Film', folder: '/d/Film', root: '/d' }).info;
  assert.equal(jy.platform.app_source, 'lv');
  assert.equal(cc.platform.app_source, 'cc');
  assert.deepEqual(cc.last_modified_platform, cc.platform);
});

test('each file is in the draft\'s media library, once, and each material names its entry', () => {
  const { info, meta } = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d' });
  const library = meta.draft_materials.find((g) => g.type === 0).value;
  const files = [...info.materials.videos, ...info.materials.audios];
  assert.equal(library.length, new Set(files.map((m) => m.path)).size, 'one entry a file');
  for (const m of files) {
    const entry = library.find((e) => e.id === m.local_material_id);
    assert.ok(entry, `${m.path} is in the library`);
    assert.equal(entry.file_Path, m.path);
  }
  const kinds = Object.fromEntries(library.map((e) => [e.file_Path.split(/[\\/]/).pop(), e.metetype]));
  assert.equal(kinds['bed fade.wav'], 'music', 'the bed, its fade its own part');
  assert.equal(kinds['b.png'], 'photo');
  assert.equal(Object.values(kinds).filter((k) => k === 'video').length, 2, 'the page rendered and the footage');
  const shot = library.find((e) => e.file_Path.endsWith('a.mp4'));
  assert.deepEqual([shot.width, shot.height, shot.duration], [960, 540, 10_000_000]);
});

test('subtitles in the language shown: a translation picked is its own, Latin words without one are English, none no task', () => {
  const cue = [{ text: 'Hola a todos', startMs: 0, durMs: 1000 }];
  const lang = (/** @type {any} */ o) => jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d', cues: cue, ...o }).info.config.subtitle_taskinfo[0]?.language;
  assert.equal(lang({ language: 'es' }), 'es-ES');
  assert.equal(lang({ language: 'zh-Hant' }), 'zh-TW');
  assert.equal(lang({}), 'en-US');
  assert.deepEqual(jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d' }).info.config.subtitle_taskinfo, []);
});
