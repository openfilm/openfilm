import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STRIP_WHOLE, clampView, cleanMoments, everyCount, everyMoments, filmFrameUrl, lastFrameMs, loadMoments, loadSharedMoments, momentAt, momentSeconds, saveMoments, sceneMiddles,
  stepFor, stripZoomMax, toggleMoment, viewShowing, zoomView,
} from './export-moments.ts';

const close = (actual: readonly number[], expected: readonly number[]) => {
  assert.equal(actual.length, expected.length, `${actual.join(', ')} vs ${expected.join(', ')}`);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]!) < 0.01, `${v} vs ${expected[i]}`));
};

test('a moment lands on a frame inside the film', () => {
  assert.equal(lastFrameMs(1000, 25), 960);
  assert.equal(momentAt(5000, 1000, 25), 960);
  assert.equal(momentAt(-20, 1000, 25), 0);
  assert.equal(momentAt(415, 1000, 25), 400);
  /* 29.97: frames are 33.367 ms, and the last one starts before the end */
  assert.ok(lastFrameMs(1000, 29.97) < 1000 && lastFrameMs(1000, 29.97) > 960);
});

test('moments are kept on frames, once each, in order, up to the most', () => {
  close(cleanMoments([500, 100, 510, 99, NaN, 9000], 1000, 25, 10), [80, 120, 520, 960]);
  close(cleanMoments([500, 100, 300], 1000, 25, 2), [120, 320]);
  assert.deepEqual(cleanMoments([100], 0, 25, 10), []);
});

test('toggling a frame adds it, or takes it out when it is there', () => {
  const one = toggleMoment([], 400, 1000, 25, 10);
  close(one, [400]);
  close(toggleMoment(one, 790, 1000, 25, 10), [400, 800]);
  close(toggleMoment(one, 410, 1000, 25, 10), []);
});

test('the middle of each scene, as the server picks scene stills', () => {
  const scenes = [{ startMs: 6000, durMs: 6000 }, { startMs: 0, durMs: 6000 }, { startMs: 200, durMs: 1000 }, { startMs: 12000, durMs: 0 }];
  close(sceneMiddles(scenes, 12000, 30), [3000, 9000]);
  /* a scene running past the film's end is cut at it */
  close(sceneMiddles([{ startMs: 0, durMs: 20000 }], 10000, 30), [5000]);
  close(sceneMiddles([], 10000, 30), [5000]);
});

test('one frame every few seconds, from the middle of each stretch', () => {
  close(everyMoments(2000, 6000, 30, 10), [1000, 3000, 5000]);
  assert.equal(everyCount(2000, 6000), 3);
  assert.equal(everyCount(2000, 5000), 2);
  assert.equal(everyMoments(1000, 600_000, 30, 200).length, 200);
  close(everyMoments(5000, 1000, 30, 10), [500]);
});

test('moments go to the server as seconds; the frame is drawn by the film page', () => {
  assert.deepEqual(momentSeconds([1000, 33.3666]), [1, 0.033]);
  assert.equal(filmFrameUrl('p 1', 1234.4, 320), '/api/projects/p%201/media?what=frame&path=film.html&ms=1234&w=320');
});

test('picks are kept per project and kind', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  try {
    assert.equal(loadMoments('a', 'images'), null);
    saveMoments('a', 'images', [1000, 2000]);
    saveMoments('a', 'slides', [500]);
    assert.deepEqual(loadMoments('a', 'images'), [1000, 2000]);
    assert.deepEqual(loadMoments('a', 'slides'), [500]);
    for (let i = 0; i < 60; i++) saveMoments(`p${i}`, 'images', [i]);
    assert.equal(loadMoments('a', 'images'), null, 'the oldest project is let go');
    assert.deepEqual(loadMoments('p59', 'images'), [59]);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('the strip zooms around the pointer, up to a second across, and stays inside the film', () => {
  const total = 60_000;
  assert.equal(stripZoomMax(total), 60);
  assert.equal(stripZoomMax(500), 1);
  const z = zoomView(STRIP_WHOLE, 4, 0.5, total);
  assert.deepEqual(z, { zoom: 4, start: 22_500 }, 'the middle stays in the middle');
  const left = zoomView(STRIP_WHOLE, 2, 0, total);
  assert.equal(left.start, 0, 'zooming at the left edge keeps the start');
  assert.deepEqual(zoomView(z, 1000, 0.5, total), { zoom: 60, start: 29_500 });
  assert.deepEqual(zoomView(z, 0.01, 0.5, total), STRIP_WHOLE);
  assert.deepEqual(clampView({ zoom: 4, start: 59_000 }, total), { zoom: 4, start: 45_000 });
  assert.deepEqual(viewShowing({ zoom: 4, start: 0 }, 30_000, total), { zoom: 4, start: 16_500 });
  assert.deepEqual(viewShowing({ zoom: 4, start: 0 }, 5000, total), { zoom: 4, start: 0 });
  assert.equal(stepFor(100, 60, [1000, 5000, 10_000]), 10_000);
  assert.equal(stepFor(10, 60, [1000, 5000]), 1000);
  assert.equal(stepFor(1000, 60, [1000, 5000]), 5000);
});

test('the shared selection migrates old image or slide picks, then stays the same across output formats', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  try {
    saveMoments('a', 'images', [1000, 2000]);
    saveMoments('a', 'slides', [3000]);
    assert.deepEqual(loadSharedMoments('a', 'images'), [1000, 2000]);
    assert.deepEqual(loadSharedMoments('a', 'slides'), [3000]);
    saveMoments('a', 'frames', [1000, 3000]);
    assert.deepEqual(loadSharedMoments('a', 'slides'), [1000, 3000]);
    assert.deepEqual(loadSharedMoments('a', 'images'), [1000, 3000]);
    saveMoments('a', 'frames', []);
    assert.deepEqual(loadSharedMoments('a', 'images'), [], 'clearing a selection does not resurrect old picks');
    assert.equal(loadSharedMoments('unknown', 'images'), null);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
