/**
 * Studio's things carried into the composer, dropped or pasted: what Studio drags out (STUDIO_REF_TYPE, a JSON array
 * of references) and a file dragged from its media pane (RESOURCE_DRAG_TYPE), which becomes a reference to that file.
 */
import { STUDIO_REF_TYPE } from 'openfilm/studio-ui/lib/host.ts';
import { RESOURCE_DRAG_TYPE, readResourceDragData } from 'openfilm/studio-ui/lib/resource-drag.ts';
import type { StudioRef } from '@/app-bridge';

const KINDS = new Set(['clip', 'layer', 'region', 'time', 'range', 'track', 'file', 'subtitle']);

/** Whether a drag or a paste carries Studio's things (a drag shows only its types until the drop). */
export function transferHasStudioRefs(data: Pick<DataTransfer, 'types'>): boolean {
  const types = [...data.types];
  return types.includes(STUDIO_REF_TYPE) || types.includes(RESOURCE_DRAG_TYPE);
}

/**
 * The references a drop or a paste carries, none when it carries none. The data comes from outside the chat and may
 * not be what Studio put there: anything not shaped as a reference is left out.
 */
export function studioRefsFromTransfer(data: Pick<DataTransfer, 'getData' | 'types'>): StudioRef[] {
  const types = [...data.types];
  if (types.includes(STUDIO_REF_TYPE)) {
    try {
      const list: unknown = JSON.parse(data.getData(STUDIO_REF_TYPE));
      return (Array.isArray(list) ? list : [list]).filter((ref): ref is StudioRef => Boolean(ref) && typeof ref === 'object' && KINDS.has((ref as { kind?: unknown }).kind as string));
    } catch {
      return [];
    }
  }
  const file = types.includes(RESOURCE_DRAG_TYPE) ? readResourceDragData(data) : null;
  if (!file) return [];
  return [{
    kind: 'file',
    path: file.path,
    fileKind: file.kind,
    ...(file.durationMs ? { duration: file.durationMs / 1000 } : {}),
    ...(file.w && file.h ? { w: file.w, h: file.h } : {}),
  }];
}
