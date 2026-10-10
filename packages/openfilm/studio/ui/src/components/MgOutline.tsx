/**
 * The outline of a clip selected elsewhere (on the timeline): placed and turned as the clip is, at least 8 × 8.
 */
import type { MgBox, MgTransform } from '@/lib/mg-transform';
import { FRAME_BLUE } from './StageTransformFrame';

export function MgOutline({ t, box, viewScale, color = FRAME_BLUE }: { t: MgTransform; box: MgBox; viewScale: number; color?: string }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: ((box.x ?? 0) + t.x) * viewScale,
        top: ((box.y ?? 0) + t.y) * viewScale,
        width: Math.max(box.w * t.scaleX * viewScale, 8),
        height: Math.max(box.h * t.scaleY * viewScale, 8),
        transform: t.rotate ? `rotate(${t.rotate}deg)` : undefined,
        transformOrigin: 'center',
        border: `2px solid ${color}`,
        boxShadow: '0 0 0 1px rgba(255,255,255,.45)',
        background: `color-mix(in srgb, ${color} 6%, transparent)`,
      }}
    />
  );
}
