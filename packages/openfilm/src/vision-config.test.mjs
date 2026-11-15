import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisCache, analysisKey, hasBeauty, hasVideoEffects, BEAUTY_KEYS, VISION_DEFAULTS, reuseAnalysis, videoEffects } from './vision-config.mjs';
import { filmHtml, readFilmFile } from './film-doc.mjs';

test('video effects default off, clamp invalid controls and round-trip as ordinary clip CSS', () => {
  assert.equal(hasVideoEffects(videoEffects(() => undefined)), false);
  const values = { '--of-cutout': '1', '--of-cutout-edge': 'NaN', '--of-beauty-smooth': '3', '--of-beauty-light': '-1' };
  const settings = videoEffects((key) => values[key]);
  assert.deepEqual(settings, { ...VISION_DEFAULTS, cutout: true, edge: 0.25, smooth: 1, light: 0, warm: 0, bypass: false, keyColor: '#00ff00', lipColor:'#a62138', blushColor:'#c45970', shadowColor:'#72505b' });
  assert.equal(hasVideoEffects({ ...settings, bypass: true }), false);
  const film = { tracks: [{ clips: [{ id: 'v', src: 'v.mp4', time: [1, 3], style: '--of-cutout: 1; --of-beauty-smooth: 0.35; filter: contrast(1.1)' }] }] };
  assert.equal(readFilmFile(filmHtml(film)).doc.tracks[0].clips[0].style, film.tracks[0].clips[0].style);
});

test('playback reuse never carries a mask across a reverse seek, jump or paused frame', () => {
  assert.equal(reuseAnalysis(1, 1.02, true), true);
  assert.equal(reuseAnalysis(1, 0.9, true), false);
  assert.equal(reuseAnalysis(1, 1.3, true), false);
  assert.equal(reuseAnalysis(1, 1.1, false), false);
});

test('analysis cache is byte bounded, reuses source times and evicts the least recently used mask', () => {
  const cache = new AnalysisCache(12);
  cache.set('a', 'first', 6); cache.set('b', 'second', 6);
  assert.equal(cache.get('a'), 'first');
  cache.set('c', 'third', 6);
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a'), 'first');
  cache.set('a', 'replacement', 4);
  assert.equal(cache.bytes, 10);
  cache.set('huge', 'unused', 13);
  assert.equal(cache.get('huge'), null);
  assert.equal(cache.bytes, 10);
  assert.equal(analysisKey('video.mp4', 1, false), analysisKey('video.mp4', 1.00000001, false));
  assert.notEqual(analysisKey('video.mp4', 1, false), analysisKey('video.mp4', 1, true));
});

test('every beauty control enables analysis, signed controls clamp and quality modes never reuse stale masks', () => {
  for (const key of BEAUTY_KEYS) assert.equal(hasBeauty({ [key]: .25 }), true, key);
  assert.equal(reuseAnalysis(1, 1.02, true, 1), false);
  assert.equal(reuseAnalysis(1, 1.02, true, 2), false);
  assert.equal(reuseAnalysis(1, 1.06, true, 0), false);
  const properties = { '--of-cutout-mode': '99', '--of-cutout-shrink': '-9', '--of-cutout-color': 'url(https://example.com)', '--of-beauty-chin': '-.5' };
  const settings = videoEffects((p) => properties[p]);
  assert.equal(settings.mode, 4); assert.equal(settings.shrink, -1); assert.equal(settings.chin, -.5); assert.equal(settings.keyColor, '#00ff00');
});
