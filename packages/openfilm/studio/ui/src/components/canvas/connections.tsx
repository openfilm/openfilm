import { useId } from 'react';
import { BaseEdge, getBezierPath, Position, useStore, ViewportPortal, type ConnectionLineComponentProps, type EdgeProps, type InternalNode, type XYPosition } from '@xyflow/react';
import type { MenuAt } from './menus';
import type { BoardNode } from './board';

function cardSide(node: InternalNode, side: Position): XYPosition {
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured.width ?? node.width ?? 0;
  const height = node.measured.height ?? node.height ?? 0;
  return { x: side === Position.Right ? x + width : x, y: y + height / 2 };
}

function WireFlow({ path, reverse = false }: { path: string; reverse?: boolean }) {
  const id = useId();
  return (
    <g className="cv-wire-flow" pointerEvents="none" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-light`}>
          <stop className="cv-wire-light" />
          <stop className="cv-wire-light" offset="1" stopOpacity={0} />
        </radialGradient>
        <mask id={`${id}-track`}>
          <path d={path} fill="none" stroke="white" strokeWidth={2.4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </mask>
      </defs>
      <g mask={`url(#${id}-track)`}>
        <circle r={82} fill={`url(#${id}-light)`}>
          <animateMotion path={path} dur="2s" repeatCount="indefinite" calcMode="linear" keyTimes="0;1" keyPoints={reverse ? '1;0' : '0;1'} />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.86;1" dur="2s" repeatCount="indefinite" />
        </circle>
      </g>
    </g>
  );
}

function Wire({ from, to, fromSide, toSide, state }: {
  from: XYPosition; to: XYPosition; fromSide: Position; toSide: Position; state: 'drag' | 'menu';
}) {
  const [path] = getBezierPath({
    sourceX: from.x, sourceY: from.y, sourcePosition: fromSide,
    targetX: to.x, targetY: to.y, targetPosition: toSide,
  });
  return (
    <g pointerEvents="none" aria-hidden="true">
      <BaseEdge path={path} data-canvas-wire={state} className="cv-wire-base cv-wire-active" vectorEffect="non-scaling-stroke" interactionWidth={0} />
      <WireFlow path={path} reverse={fromSide === Position.Left} />
    </g>
  );
}

function CanvasWire({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data, ...props }: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const active = selected || data?.lit === true;
  const { interactionWidth, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, markerStart, markerEnd } = props;
  return (
    <>
      <BaseEdge id={id} path={path} labelX={labelX} labelY={labelY}
        {...{ interactionWidth, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, markerStart, markerEnd }}
        data-canvas-wire="edge" className={active ? 'cv-wire-base cv-wire-active' : 'cv-wire-base'} vectorEffect="non-scaling-stroke" />
      {active ? <WireFlow path={path} /> : null}
    </>
  );
}

export const CANVAS_EDGE_TYPES = { canvas: CanvasWire };
export const CANVAS_EDGE_OPTIONS = { type: 'canvas' };

export function DraggedWire({ fromNode, fromHandle, fromPosition, fromX, fromY, toX, toY, toPosition }: ConnectionLineComponentProps<BoardNode>) {
  const plus = fromHandle.id === 'in' || fromHandle.id === 'out';
  const from = plus ? cardSide(fromNode, fromPosition) : { x: fromX, y: fromY };
  return <Wire from={from} to={{ x: toX, y: toY }} fromSide={fromPosition} toSide={toPosition} state="drag" />;
}

/** Keep the wire at the release point while the add menu is open. */
export function MenuWire({ menu }: { menu: MenuAt }) {
  const from = useStore((state) => state.nodeLookup.get(menu.from?.node ?? ''));
  if (!from || !menu.from) return null;
  const side = menu.from.side === 'source' ? Position.Right : Position.Left;
  return (
    <ViewportPortal>
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={1} height={1} aria-hidden="true">
        <Wire from={cardSide(from, side)} to={menu.at} fromSide={side}
          toSide={side === Position.Right ? Position.Left : Position.Right} state="menu" />
      </svg>
    </ViewportPortal>
  );
}
