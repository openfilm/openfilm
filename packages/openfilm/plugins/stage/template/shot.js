// A shot: the set, who moves how, and the camera, each a function of t (seconds). Written by `openfilm stage new`;
// rewrite all of it. Meters, y up; the room's open side is +z, where the camera starts.
import { createStage, room, box, lerp, progress } from '../lib/stage.js';
import { mannequin, apply, walk, move, lookAt } from '../lib/mannequin.js';

const DURATION = 6;

export function shot({ pass = 'beauty' } = {}) {
  const { scene, camera, draw } = createStage({ pass, fov: 38 });

  // the set
  room(scene, { width: 8, depth: 8, height: 3, back: { openings: [{ at: 1.8, width: 1.1 }] } });
  box(scene, { name: 'table', size: [1.6, 0.75, 0.9], at: [1.9, 0, -1.6] });

  // who is in it
  const ana = mannequin({ name: 'ana' });
  scene.add(ana.root);
  const path = [[-2.2, -4.4], [-1.6, -2.4], [0.6, -0.6]];

  function frame(t) {
    // ana comes in through the door and crosses the room at 0.9 m/s, stopping by the table
    const d = 0.9 * t;
    const { length } = move(ana, path, d);
    apply(ana, walk(d, { from: null, stopAt: length })); // already walking as the shot starts
    lookAt(ana, [1.9, 0.9, -1.6], progress(t, 4.5, 5.5));

    // the camera: wide on the room, moving in to a medium shot of her
    const k = progress(t, 0, DURATION);
    camera.position.set(lerp(2.6, 1.6, k), lerp(2.2, 1.5, k), lerp(6.5, 2.6, k));
    camera.lookAt(lerp(-0.6, ana.root.position.x, k), lerp(1.1, 1.3, k), lerp(-2, ana.root.position.z, k));
    draw();
  }
  return { frame, duration: DURATION, scene, camera };
}
