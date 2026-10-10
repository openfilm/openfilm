/**
 * The frame of the thing in hand on the stage, shared by a whole clip and a layer inside one (Figma's look).
 *
 * A 1px blue border and white corner squares with a blue edge (scale); an invisible ring outside the corners turns the
 * pointer into the rotate cursor; invisible strips on the edges stretch one side (a layer's override scale has x and y;
 * a video's or still's box takes any proportions, its CSS fitting the picture in it; a page's is never stretched, so
 * its frame has corners only). A blue size label sits below the frame. While a gesture runs, a value tag follows the
 * pointer: the position when moving, the size when scaling, the angle when turning.
 *
 * Geometry is the frame's own center, size and angle, not its bounding box: a turned thing has a turned frame.
 *
 * Three sets of data attributes: a whole clip's (`data-mg-kind` / `data-mg-handle`), a layer's (`data-layer-kind` /
 * `data-layer-handle`) and a crop's in crop mode (`data-crop-kind` / `data-crop-handle`); one pointer press is routed
 * by the set it lands on.
 */
/** The stage's "this one" blue: the frame, picked layers and linked outlines are drawn in it. */
export const FRAME_BLUE = '#0d99ff';

export type FrameCorner = 'nw' | 'ne' | 'se' | 'sw';
export type FrameEdge = 'n' | 'e' | 's' | 'w';

export interface FrameGeometry {
  /** Center, in the stage overlay's px. */
  cx: number;
  cy: number;
  /** Width and height before turning. */
  w: number;
  h: number;
  /** Clockwise, degrees. */
  r: number;
}

const CORNERS: FrameCorner[] = ['nw', 'ne', 'se', 'sw'];

/** The handle ring's least size (px): 8px squares at least a square apart, with room left to press and drag. */
export const HANDLE_BOX_MIN = 28;
const EDGES: FrameEdge[] = ['n', 'e', 's', 'w'];

const CORNER_AT: Record<FrameCorner, { x: 0 | 1; y: 0 | 1 }> = {
  nw: { x: 0, y: 0 }, ne: { x: 1, y: 0 }, se: { x: 1, y: 1 }, sw: { x: 0, y: 1 },
};

/*
 * The rotate cursor: a quarter arc with an arrow at each end (Figma's; browsers have no such cursor). Drawn for the
 * top-right corner; other corners and turned frames turn it, cached in 15° steps.
 */
const ROTATE_CURSORS = new Map<number, string>();
function rotateCursor(angle: number): string {
  const a = ((Math.round(angle / 15) * 15) % 360 + 360) % 360;
  const hit = ROTATE_CURSORS.get(a);
  if (hit) return hit;
  const arc = 'M5 8A11 11 0 0 1 16 19M8.2 4.8L5 8l3.2 3.2M12.8 15.8L16 19l3.2-3.2';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
    + `<g transform="rotate(${a} 12 12)" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="${arc}" stroke="white" stroke-width="3.6"/>`
    + `<path d="${arc}" stroke="black" stroke-width="1.5"/>`
    + '</g></svg>';
  const css = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
  ROTATE_CURSORS.set(a, css);
  return css;
}
const ROTATE_AT: Record<FrameCorner, number> = { ne: 0, se: 90, sw: 180, nw: 270 };

/** A resize cursor for an angle: after a 90° turn, the top edge drags sideways. */
function resizeCursor(angle: number): string {
  const a = ((angle % 180) + 180) % 180;
  if (a < 22.5 || a >= 157.5) return 'ew-resize';
  if (a < 67.5) return 'nwse-resize';
  if (a < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

const CORNER_ANGLE: Record<FrameCorner, number> = { nw: 45, ne: 135, se: 45, sw: 135 };
const EDGE_ANGLE: Record<FrameEdge, number> = { n: 90, s: 90, e: 0, w: 0 };

export function StageTransformFrame({
  frame,
  scope,
  corners = 'scale',
  edges = false,
  rotate = true,
  label,
  moving = false,
  bounds,
}: {
  frame: FrameGeometry;
  /** Which set of handle attributes (see the file head): `mg` for a whole clip, `layer` for a layer, `crop` for a crop. */
  scope: 'mg' | 'layer' | 'crop';
  corners?: 'scale' | 'none';
  edges?: boolean;
  rotate?: boolean;
  /** The size label below the frame; null for none. */
  label?: string | null;
  /** Being moved: a light fill. */
  moving?: boolean;
  /** The stage's size in overlay px: the size label stays on it (below it is the viewer's own bar). */
  bounds?: { w: number; h: number };
}) {
  const w = Math.max(frame.w, 1);
  const h = Math.max(frame.h, 1);
  /*
   * Handles sit on a frame at least HANDLE_BOX_MIN big: on something tiny (an icon, a thin line) corner squares on its
   * own edges would pile up over it. As in Figma the blue border keeps the true size and the handles go on the ring
   * outside, the whole middle still draggable.
   */
  const hw = Math.max(w, HANDLE_BOX_MIN);
  const hh = Math.max(h, HANDLE_BOX_MIN);
  const kindAttr = `data-${scope}-kind`;
  const handleAttr = `data-${scope}-handle`;
  const attrs = (kind: string, handle: string) => ({ [kindAttr]: kind, [handleAttr]: handle });
  /* edge strips leave room for the corners; on a short frame in proportion, never below zero */
  const insetX = Math.min(8, hw / 4);
  const insetY = Math.min(8, hh / 4);
  return (
    <>
      <div
        className="pointer-events-none absolute"
        style={{
          left: frame.cx - hw / 2,
          top: frame.cy - hh / 2,
          width: hw,
          height: hh,
          transform: frame.r ? `rotate(${frame.r}deg)` : undefined,
          transformOrigin: 'center',
        }}
      >
        <div
          {...attrs('move', 'move')}
          /* inside a crop the hand pans the picture: the grab hand says so */
          className={`pointer-events-auto absolute inset-0 ${moving ? 'cursor-grabbing' : scope === 'crop' ? 'cursor-grab' : 'cursor-default'}`}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: (hw - w) / 2,
            top: (hh - h) / 2,
            width: w,
            height: h,
            /* a border on something a pixel or two big would cover it: outline it from outside instead */
            ...(w < 3 || h < 3 ? { boxShadow: `0 0 0 1px ${FRAME_BLUE}` } : { border: `1px solid ${FRAME_BLUE}` }),
            background: moving ? 'rgba(13,153,255,.06)' : 'transparent',
          }}
        />
        {edges ? EDGES.map((edge) => (
          <div
            key={edge}
            {...attrs('stretch', edge)}
            aria-hidden
            className="pointer-events-auto absolute"
            style={{
              cursor: resizeCursor(EDGE_ANGLE[edge] + frame.r),
              ...(edge === 'n' ? { left: insetX, right: insetX, top: -4, height: 8 }
                : edge === 's' ? { left: insetX, right: insetX, bottom: -4, height: 8 }
                  : edge === 'w' ? { top: insetY, bottom: insetY, left: -4, width: 8 }
                    : { top: insetY, bottom: insetY, right: -4, width: 8 }),
            }}
          />
        )) : null}
        {rotate ? CORNERS.map((corner) => {
          const at = CORNER_AT[corner];
          return (
            <div
              key={`rot-${corner}`}
              {...attrs('rotate', corner)}
              aria-hidden
              className="pointer-events-auto absolute"
              style={{
                width: 20,
                height: 20,
                left: at.x ? undefined : -20,
                right: at.x ? -20 : undefined,
                top: at.y ? undefined : -20,
                bottom: at.y ? -20 : undefined,
                cursor: rotateCursor(ROTATE_AT[corner] + frame.r),
              }}
            />
          );
        }) : null}
        {corners === 'scale' ? CORNERS.map((corner) => {
          const at = CORNER_AT[corner];
          return (
            <div
              key={corner}
              {...attrs('scale', corner)}
              aria-hidden
              className="pointer-events-auto absolute flex items-center justify-center"
              style={{
                width: 14,
                height: 14,
                left: `calc(${at.x * 100}% - 7px)`,
                top: `calc(${at.y * 100}% - 7px)`,
                cursor: resizeCursor(CORNER_ANGLE[corner] + frame.r),
              }}
            >
              <span
                className="block h-[8px] w-[8px] bg-white"
                style={{ border: `1px solid ${FRAME_BLUE}`, boxShadow: '0 0 0 0.5px rgba(0,0,0,.08)' }}
              />
            </div>
          );
        }) : null}
      </div>
      {/* shown while dragging too: the frame moves and its size changes, and the label follows (as in Figma) */}
      {label ? <FrameLabel frame={{ ...frame, w: hw, h: hh }} text={label} {...(bounds ? { bounds } : {})} /> : null}
    </>
  );
}

/** The label's height (14px line + 1px padding each side) and its gap to the frame. */
const LABEL_H = 16;
const LABEL_GAP = 6;

/**
 * The size label: 6px below the bounding box's bottom, centered; it does not turn with the frame. Something reaching
 * the stage's bottom (a full-frame clip) has it just inside its bottom edge instead, clear of the viewer's bar.
 */
function FrameLabel({ frame, text, bounds }: { frame: FrameGeometry; text: string; bounds?: { w: number; h: number } }) {
  const rad = (frame.r * Math.PI) / 180;
  const halfH = (Math.abs(frame.w * Math.sin(rad)) + Math.abs(frame.h * Math.cos(rad))) / 2;
  const below = frame.cy + halfH + LABEL_GAP;
  const top = bounds && below + LABEL_H > bounds.h ? Math.max(0, Math.min(below, bounds.h) - LABEL_H - LABEL_GAP) : below;
  return (
    <div
      className="pointer-events-none absolute z-[7] -translate-x-1/2 whitespace-nowrap rounded-[3px] px-1 py-[1px] text-[10px] font-medium leading-[14px] text-white tabular-nums"
      style={{ left: frame.cx, top, background: FRAME_BLUE }}
    >
      {text}
    </div>
  );
}

/** The value tag next to the pointer while a gesture runs. */
export function GestureHint({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div
      className="pointer-events-none absolute z-[8] whitespace-nowrap rounded-[4px] px-1.5 py-[2px] text-[10.5px] font-medium leading-[15px] text-white tabular-nums shadow-[0_1px_4px_rgba(0,0,0,.25)]"
      style={{ left: x + 14, top: y + 16, background: 'rgba(30,30,30,.92)' }}
    >
      {text}
    </div>
  );
}
