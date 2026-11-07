import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { charactersRoute, listCharacters, saveCharacter, useCharacter } from './canvas-characters.mjs';

test('a character is kept with its pictures, put on any project, renamed and moved to the trash', async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-characters-'));
  const before = { home: process.env.OPENFILM_SHARED_HOME, trash: process.env.OPENFILM_TRASH_DIR };
  process.env.OPENFILM_SHARED_HOME = join(scratch, 'home');
  process.env.OPENFILM_TRASH_DIR = join(scratch, 'trash');
  t.after(() => {
    for (const [k, v] of [['OPENFILM_SHARED_HOME', before.home], ['OPENFILM_TRASH_DIR', before.trash]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(scratch, { recursive: true, force: true });
  });
  const a = join(scratch, 'a');
  mkdirSync(join(a, 'assets/image'), { recursive: true });
  writeFileSync(join(a, 'assets/image/mia.png'), 'face');
  writeFileSync(join(a, 'assets/image/mia-body.jpg'), 'body');
  await assert.rejects(saveCharacter(a, { name: '' }), /has a name/);
  await assert.rejects(saveCharacter(a, { name: 'Mia', pictures: [{ role: 'face', path: 'notes.txt' }] }), /has a picture/);
  const kept = await saveCharacter(a, { name: ' Mia ', about: 'red coat, short hair', pictures: [{ role: 'face', path: 'assets/image/mia.png' }, { role: 'body', path: 'assets/image/mia-body.jpg' }, { role: 'nope', path: 'assets/image/gone.png' }] });
  assert.equal(kept.name, 'Mia');
  assert.deepEqual(kept.pictures.map((p) => p.role), ['face', 'body']);
  assert.deepEqual((await listCharacters()).map((c) => c.name), ['Mia']);
  /* put on another project: copied into its assets, twice without overwriting */
  const b = join(scratch, 'b');
  mkdirSync(b);
  const used = await useCharacter(b, kept.id);
  assert.deepEqual(used.pictures, [{ role: 'face', path: 'assets/characters/mia/mia-face.png' }, { role: 'body', path: 'assets/characters/mia/mia-body.jpg' }]);
  assert.equal(readFileSync(join(b, used.pictures[0].path), 'utf8'), 'face');
  assert.equal((await useCharacter(b, kept.id)).pictures[0].path, 'assets/characters/mia/mia-face-2.png');
  const call = async (method, parts, body) => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method });
    const res = { status: 0, body: '', writeHead(s) { res.status = s; }, end(x) { res.body = x; } };
    await charactersRoute(/** @type {any} */ (req), /** @type {any} */ (res), parts);
    return res;
  };
  assert.equal((await call('GET', [kept.id, 'files', 'face-1.png'])).body.toString(), 'face');
  assert.equal(JSON.parse((await call('PATCH', [kept.id], { name: 'Mia Chen' })).body).character.name, 'Mia Chen');
  await call('DELETE', [kept.id]);
  assert.deepEqual(await listCharacters(), []);
  assert.ok(existsSync(join(scratch, 'trash', kept.id)));
});
