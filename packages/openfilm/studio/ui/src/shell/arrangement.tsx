/**
 * The arrangement laid out among the page's panels (shell/layout `arrangement`): the edit's, or that of the plugin's
 * workbench shown there. Each block its workbench draws (studio/blocks `drawing`) gets a slot, laid out where the
 * arrangement puts it: where the panels are docked, the main block in a row with the blocks beside it, the blocks above
 * and below it round that row, each sized as its workbench says (shell/layout `amongDrawn`) with a seam to size it;
 * where they float, each in its box. The block's own place (studio/blocks `mountOf`) is put in its slot, and the
 * workbench draws into it. The room the docked blocks share is measured here, and which blocks are shown is said.
 */
import * as React from 'react';
import { DOCK_GAP, DockPaneDivider, PaneDivider } from '@/components/PaneDivider';
import { centerOf, type BlockSpec } from '@/lib/workspaces';
import { attached, blockKey, drawingStore, mountOf, shownBlocks } from '@/studio/blocks';
import type { useProjectFrame } from './ProjectFrame';

/** How the arrangement among the panels is hidden while something else is shown over it (the canvas, a plugin's surface, the notice that none is on): what its blocks draw on top of themselves (the edit's marks on its picture) is not seen through. */
const HIDDEN = { visibility: 'hidden', opacity: 0 } as const;
const SLOT = 'relative flex min-h-0 min-w-0 flex-col';

export function Arrangement({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const { loaded, failure, arrangement, amongDrawn, places, blockBox, setBlockRoom, placeBlock, canvasOpen, noBench, away, surface, surfaceArrangement, among, drawnIn } = frame;
  const drawing = React.useSyncExternalStore(drawingStore.subscribe, drawingStore.get);
  const { spec, layout, free } = arrangement;
  const colRef = React.useRef<HTMLElement | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  /* the arrangement is the one shown: not under the canvas, a plugin's surface, or the notice that none is on */
  const shown = !canvasOpen && !noBench && (surface == null || surfaceArrangement === among);
  const drawable = drawnIn(spec);
  const keyOf = (block: BlockSpec) => blockKey(block.owner, block.id);
  const anyDrawn = Boolean(loaded) && !failure && spec.blocks.some((block) => drawing.has(keyOf(block)));
  const there = spec.blocks.filter((block) => drawing.has(keyOf(block)) && drawable(block.key) && amongDrawn[block.key]?.shown);
  /* which blocks are shown now: those of this arrangement while it is, and the canvas's board while it is */
  const shownKeys = [...(shown && anyDrawn ? there.map(keyOf) : []), ...(canvasOpen && !away ? [blockKey('canvas', 'canvas')] : [])].join('\n');
  React.useLayoutEffect(() => { shownBlocks.set(new Set(shownKeys ? shownKeys.split('\n') : [])); }, [shownKeys]);
  /* the room the docked blocks share: the row's width, the column's height */
  React.useEffect(() => {
    const row = rowRef.current, col = colRef.current;
    if (!row || !col) return undefined;
    const now = { width: 0, height: 0 };
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === row) now.width = Math.round(entry.contentRect.width);
        else now.height = Math.round(entry.contentRect.height);
      }
      const next = { ...now };
      setBlockRoom((was) => (was.width === next.width && was.height === next.height ? was : next));
    });
    ro.observe(row);
    ro.observe(col);
    return () => ro.disconnect();
  }, [anyDrawn, setBlockRoom]);
  /* each block's slot takes its place in, the same way each time */
  const attach = React.useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const attachOf = (block: BlockSpec) => {
    const key = keyOf(block);
    let ref = attach.current.get(key);
    if (!ref) {
      ref = (el) => {
        if (el) el.append(mountOf(block.owner, block.id));
        attached(key, Boolean(el));
      };
      attach.current.set(key, ref);
    }
    return ref;
  };
  if (!anyDrawn) return null;

  const center = centerOf(spec);
  const edgeOf = (block: BlockSpec) => layout.blocks[block.key]?.edge ?? block.edge;
  const isThere = (block: BlockSpec) => there.includes(block);
  const others = spec.blocks.filter((block) => block !== center);
  const beside = others.filter((block) => edgeOf(block) === 'left' || edgeOf(block) === 'right');
  const tops = others.filter((block) => edgeOf(block) === 'top');
  const bottoms = others.filter((block) => edgeOf(block) === 'bottom');
  const before = (block: BlockSpec) => center != null && spec.blocks.indexOf(block) < spec.blocks.indexOf(center);
  /* the order each is drawn in along its line: those beside the main block left of it, then right of it; above it, then below it */
  const order = (block: BlockSpec) => {
    const side = beside.indexOf(block);
    if (side >= 0) return edgeOf(block) === 'left' ? 10 * (side + 1) : 70 + 10 * side;
    const top = tops.indexOf(block);
    return top >= 0 ? 2 * top : 2 * tops.length + 2 + 2 * bottoms.indexOf(block);
  };
  const slot = (block: BlockSpec, style: React.CSSProperties, grow = false) => (
    <div key={block.key} ref={attachOf(block)} data-block={block.key} className={`${SLOT} ${grow ? 'flex-1' : 'shrink-0'}`}
      style={{ ...style, ...blockBox(block.key) }} />
  );
  const seam = (block: BlockSpec) => {
    const drawn = amongDrawn[block.key]!;
    if (free || !drawn.seam) return null;
    const resize = (size: number) => placeBlock(block.key, { size });
    const at = order(block);
    if (beside.includes(block)) {
      const left = edgeOf(block) === 'left';
      return <PaneDivider key={`${block.key}-seam`} width={drawn.size} onResize={resize} containerRef={rowRef} label={drawn.seam.label} min={drawn.seam.min} minRest={drawn.seam.minRest}
        relative side={left ? 'start' : 'end'} style={{ order: left ? at + 1 : at - 1 }} />;
    }
    const top = edgeOf(block) === 'top';
    return <DockPaneDivider key={`${block.key}-seam`} height={drawn.size} onResize={resize} containerRef={colRef} label={drawn.seam.label} min={drawn.seam.min} minRest={drawn.seam.minRest}
      edge={top ? 'top' : 'bottom'} style={{ order: top ? at + 1 : at - 1 }} />;
  };
  /* a block and its seam, the seam on the main block's side of it as they are drawn */
  const withSeam = (block: BlockSpec, style: React.CSSProperties) => (before(block) ? [slot(block, style), seam(block)] : [seam(block), slot(block, style)]);
  return (
    <section ref={colRef} inert={!shown} aria-hidden={!shown} className="relative flex min-h-0 min-w-0 flex-col bg-[var(--dock-line)]"
      style={{ gridArea: 'main', paddingTop: DOCK_GAP, ...places.among, ...(shown ? null : HIDDEN) }}>
      <div ref={rowRef} className="relative flex min-h-0 min-w-0 flex-1 flex-row" style={{ order: 2 * tops.length }}>
        {spec.blocks.filter((block) => block === center || beside.includes(block)).flatMap((block) => (!isThere(block) ? []
          : block === center ? [slot(block, { order: 50 }, true)] : withSeam(block, { width: amongDrawn[block.key]!.size, order: order(block) })))}
      </div>
      {[...tops, ...bottoms].filter(isThere).flatMap((block) => withSeam(block, { height: amongDrawn[block.key]!.size, order: order(block) }))}
    </section>
  );
}
