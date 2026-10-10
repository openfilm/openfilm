import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fontMenu, knownAvailable, localeFromName, matchScore, projectFontFaceCss, pushRecent, rowFontFamily, sampleOf, stylesOf,
  type InstalledFont, type ProjectFont,
} from './font-menu.ts';

const installed: InstalledFont[] = [
  { family: 'Arial', locale: 'latin', weights: [400, 700], italics: [400, 700] },
  { family: 'Georgia', locale: 'latin', weights: [400, 700] },
  { family: 'LXGW WenKai', locale: 'zh-CN', aliases: ['霞鹜文楷'], weights: [300, 400, 700] },
  { family: 'Hiragino Sans', locale: 'ja-JP', weights: [300, 600] },
];
const face = (family: string, path = `fonts/${family}.ttf`) => ({ family, weight: [100, 900] as [number, number], style: 'normal' as const, src: [{ path }], file: 'lib/shared.css' });
const project: ProjectFont[] = [
  { family: 'Geist', weights: [100, 900], variable: [100, 900], faces: [face('Geist')] },
  { family: 'Inter', weights: [100, 900], variable: [100, 900], faces: [face('Inter')] },
  { family: 'Noto Sans SC', weights: [400], faces: [face('Noto Sans SC')] },
];
const page = { path: 's1.html', declared: ['Geist', 'Noto Sans SC'], used: ['Geist', 'Noto Sans SC', 'Georgia', 'Proxima Nova'] };

test('sections: this project, recent, then installed fonts by script', () => {
  const menu = fontMenu({ installed, project, page, recent: ['Arial', 'sans-serif'] });
  assert.deepEqual(menu.map((s) => s.id), ['project', 'recent', 'latin', 'zh-CN', 'ja-JP']);
  assert.deepEqual(menu[0]!.rows.map((r) => r.family), ['Geist', 'Georgia', 'Noto Sans SC', 'Proxima Nova', 'Inter'], 'this page\'s, then other pages\'');
  assert.equal(menu[0]!.rows.find((r) => r.family === 'Inter')!.elsewhere, true, 'declared by another page only');
  assert.equal(menu[0]!.rows.find((r) => r.family === 'Geist')!.project, true);
  assert.equal(menu[0]!.rows.find((r) => r.family === 'Noto Sans SC')!.locale, 'zh-CN', 'its script from its name');
  assert.deepEqual(menu[1]!.rows.map((r) => r.family), ['Arial'], 'no generic family among the recent');
  assert.deepEqual(fontMenu({ installed, project, recent: [], cjkFirst: true }).map((s) => s.id), ['project', 'zh-CN', 'ja-JP', 'latin'], 'CJK first for CJK text');
});

test('search: every section filtered by names and aliases, best matches first, no Recent', () => {
  const menu = fontMenu({ installed, project, page, recent: ['Arial'], query: 'wen' });
  assert.deepEqual(menu.map((s) => [s.id, s.rows.map((r) => r.family)]), [['zh-CN', ['LXGW WenKai']]]);
  assert.deepEqual(fontMenu({ installed, project, page, recent: [], query: '霞鹜' })[0]!.rows.map((r) => r.family), ['LXGW WenKai'], 'by its native name');
  const ge = fontMenu({ installed, project: [], page: null, recent: [], query: 'ge' });
  assert.deepEqual(ge[0]!.rows.map((r) => r.family), ['Georgia']);
  assert.ok(matchScore('Georgia', [], 'georgia') > matchScore('Georgia', [], 'geo'));
  assert.ok(matchScore('Source Sans', [], 'sans') > matchScore('Transans', [], 'sans'), 'a word\'s start before the middle');
  assert.equal(matchScore('Arial', [], 'xyz'), 0);
});

test('whether a family can be drawn, from the lists', () => {
  assert.equal(knownAvailable('sans-serif', installed, project, page), true);
  assert.equal(knownAvailable('霞鹜文楷', installed, project, page), true, 'by an alias');
  assert.equal(knownAvailable('Geist', installed, project, page), true, 'declared for this page');
  assert.equal(knownAvailable('Inter', installed, project, page), null, 'declared by another page: not known here');
  assert.equal(knownAvailable('Proxima Nova', installed, project, page), null);
  const gone: ProjectFont[] = [{ family: 'Gone', weights: [400], faces: [face('Gone')], missing: true }];
  assert.equal(knownAvailable('Gone', installed, gone, { path: 'a.html', declared: ['Gone'], used: [] }), false, 'its files are not there');
});

test('a family\'s styles: the project\'s declaration before the installed font', () => {
  assert.deepEqual(stylesOf('arial', installed, project), { weights: [400, 700], italics: [400, 700] });
  assert.equal(stylesOf('Geist', installed, project)!.variable?.[1], 900);
  assert.equal(stylesOf('Nope', installed, project), null);
});

test('recent, samples, and project faces in Studio', () => {
  assert.deepEqual(pushRecent(['A', 'B', 'C'], 'b'), ['b', 'A', 'C']);
  assert.deepEqual(pushRecent(['A'], 'serif'), ['A']);
  assert.equal(pushRecent(Array.from({ length: 8 }, (_, i) => `F${i}`), 'New').length, 8);
  assert.equal(sampleOf({ family: 'PingFang SC', locale: 'zh-CN', sample: '永' }), '永');
  assert.equal(sampleOf({ family: '霞鹜文楷', locale: 'zh-CN', sample: '永' }), null, 'its name shows the script');
  assert.equal(sampleOf({ family: 'Arial', locale: 'latin' }), null);
  const cjk = fontMenu({
    installed: [{ family: 'Heiti SC', locale: 'zh-CN', sample: '永' }, { family: 'Apple Chancery', locale: 'zh-CN' }],
    project: [], page: { path: 'a.html', declared: [], used: ['PingFang SC'] }, recent: [],
  });
  assert.deepEqual(cjk.flatMap((s) => s.rows.map((r) => [r.family, sampleOf(r)])), [['PingFang SC', '永'], ['Heiti SC', '永'], ['Apple Chancery', null]],
    'an installed font\'s sample only when it draws it; a named one by its name');
  assert.equal(localeFromName('Source Han Sans JP'), 'ja-JP');
  assert.equal(rowFontFamily({ family: 'Geist', project: true }), '"OpenFilm Project Geist", "Geist", system-ui');
  const css = projectFontFaceCss([{ ...project[0]!, faces: [{ ...face('Geist', 'fonts/My Geist.ttf'), src: [{ path: 'fonts/My Geist.ttf', format: 'truetype' }, { local: 'Geist' }] }] }], 'http://localhost:5/p/t/');
  assert.equal(css, '@font-face { font-family: "OpenFilm Project Geist"; src: url("http://localhost:5/p/t/fonts/My%20Geist.ttf") format("truetype"), local("Geist"); font-weight: 100 900; font-style: normal; font-display: swap; }');
});
