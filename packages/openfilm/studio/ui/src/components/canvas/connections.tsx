import { getBezierPath, Position, useReactFlow, useStore, useViewport, ViewportPortal, type ConnectionLineComponentProps, type InternalNode, type XYPosition } from '@xyflow/react';
import { addMenuPlacement, type MenuAt } from './menus';
import type { BoardNode } from './board';

function cardSide(node: InternalNode, side: Position): XYPosition {
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured.width ?? node.width ?? 0;
  const height = node.measured.height ?? node.height ?? 0;
  return { x: side === Position.Right ? x + width : x, y: y + height / 2 };
}

function Wire({ from, to, fromSide, toSide, pending }: {
  from: XYPosition; to: XYPosition; fromSide: Position; toSide: Position; pending?: boolean;
}) {
  const [path] = getBezierPath({
    sourceX: from.x, sourceY: from.y, sourcePosition: fromSide,
    targetX: to.x, targetY: to.y, targetPosition: toSide,
  });
  return (
    <g fill="none" strokeLinecap="round">
      <path data-canvas-wire={pending ? 'menu' : 'drag'} d={path}
        stroke="var(--cv-edge)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {!pending ? <path className="cv-wire-flow" d={path} vectorEffect="non-scaling-stroke"
        style={{ animationDirection: fromSide === Position.Left ? 'reverse' : 'normal' }} /> : null}
    </g>
  );
}

export function DraggedWire({ fromNode, fromHandle, fromPosition, fromX, fromY, toX, toY, toPosition }: ConnectionLineComponentProps<BoardNode>) {
  const plus = fromHandle.id === 'in' || fromHandle.id === 'out';
  const from = plus ? cardSide(fromNode, fromPosition) : { x: fromX, y: fromY };
  return (
    <g pointerEvents="none" aria-hidden="true">
      <Wire from={from} to={{ x: toX, y: toY }} fromSide={fromPosition} toSide={toPosition} />
    </g>
  );
}

/** The dropped wire stays attached to the visible edge of the add menu while it is open. */
export function MenuWire({ menu }: { menu: MenuAt }) {
  const from = useStore((state) => state.nodeLookup.get(menu.from?.node ?? ''));
  const flow = useReactFlow<BoardNode>();
  useViewport();
  if (!from || !menu.from) return null;
  const { anchor, leftOfPointer } = addMenuPlacement(menu);
  const side = menu.from.side === 'source' ? Position.Right : Position.Left;
  return (
    <ViewportPortal>
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={1} height={1} aria-hidden="true">
        <Wire from={cardSide(from, side)} to={flow.screenToFlowPosition(anchor, { snapToGrid: false })}
          fromSide={side} toSide={leftOfPointer ? Position.Right : Position.Left} pending />
      </svg>
    </ViewportPortal>
  );
}
