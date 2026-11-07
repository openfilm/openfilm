import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCanvasDoc } from './canvas.ts';
import { builtInTemplates } from './canvas-templates.ts';

test('the templates OpenFilm comes with are boards as kept: in their group, wired, every node read', () => {
  for (const template of builtInTemplates((key) => key)) {
    const read = readCanvasDoc(template.doc);
    assert.equal(read.nodes.length, template.doc.nodes.length, template.id);
    assert.equal(read.edges.length, template.doc.edges.length, template.id);
    const [group, ...inside] = read.nodes;
    assert.ok(group?.group, `${template.id} is a group`);
    for (const n of inside) {
      assert.equal(n.parent, group.id);
      assert.ok(n.x + (n.w ?? 0) <= (group.w ?? 0) && n.y >= 0, `${n.id} is inside its group`);
    }
  }
});
