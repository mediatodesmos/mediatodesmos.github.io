/**
 * A whole video as ONE Desmos graph:
 *   - slider F = current frame (1..N), advanced by a ticker
 *   - frame data concatenated into chunk lists under Desmos' 10,000-item limit
 *   - outline: shared-endpoint Bezier points (see packed.ts). Within a frame the
 *     chains are separated by two "u" (undefined) fillers, so every segment
 *     start in the frame is 3 apart and the frame is simply
 *         P_c(t, U_c[F] + 3[0...N_c[F]])
 *   - fill: one bridged polygon per frame, sliced X[U_c[F]...V_c[F]]
 *   - frames that repeat the previous frame (held animation frames) reuse its
 *     data instead of storing it again
 * Item 1 of every data list is u (undefined): frames that live in another
 * chunk point at it, so that chunk draws nothing.
 */

import type { Shape, StrokeShape, TraceResult } from '../pipeline/types';
import { INK, bridgedPath, regionRings, type BuiltGraph, type InspectorEntry } from './build';
import { num, polygonLatex } from './latex';
import { BEZIER_FN, BEZIER_FN_ID, LIST_CAP, UNDEF_ID, UNDEF_VAR, coordUnit, packedList, pName, pointFn, strokePoints, unitList, unitTimes, xName, yName } from './packed';
import { emptyState, imageViewport, stateWeight, type DesmosItem } from './state';

/** Max data items per chunk list (item 1 is the undefined placeholder). */
export const CHUNK_CAP = LIST_CAP;

export interface VideoBuildOptions {
  fps: number;
  strokeWidth: number;
  name?: string;
  /** Decimal places for coordinates (default: 0 for frames 500 px or larger, else 1). */
  decimals?: number;
}

export interface VideoChunk {
  index: number;
  firstFrame: number;
  lastFrame: number;
  items: number;
}

export interface BuiltVideo extends BuiltGraph {
  frames: number;
  fps: number;
  chunks: VideoChunk[];
  kind: 'outline' | 'fill';
  /** Frames that reused the previous frame's data. */
  repeated: number;
}

type Item = number | string;

interface ChunkAcc {
  xs: Item[];
  ys: Item[];
  segs: number;
  /** Fill: where each region's points start and end (region 1 is the undefined placeholder). */
  starts: number[];
  ends: number[];
}

/** Where a frame's data lives: chunk index, first item, and (outline) last-segment offset / (fill) last item. */
interface Placement {
  chunk: number;
  a: number;
  b: number;
}

/** Outline frame data: chains joined with two undefined fillers so all segment starts are 3 apart. */
function outlineFrame(shapes: Shape[], H: number): { xs: Item[]; ys: Item[]; segs: number } {
  const xs: Item[] = [], ys: Item[] = [];
  let segs = 0;
  const strokes = shapes.filter((s): s is StrokeShape => s.kind === 'stroke' && s.segs.length >= 8);
  strokes.forEach((sh, i) => {
    if (i > 0) {
      xs.push('u', 'u');
      ys.push('u', 'u');
      segs += 1; // the bridge "segment" (undefined, draws nothing)
    }
    const p = strokePoints(sh.segs, H);
    xs.push(...p.xs);
    ys.push(...p.ys);
    segs += sh.segs.length / 8;
  });
  return { xs, ys, segs };
}

/** Fill frame data: each region's outline (holes bridged in), end to end, plus each region's point count. */
function fillFrame(shapes: Shape[], H: number): { xs: Item[]; ys: Item[]; lens: number[] } {
  const xs: Item[] = [], ys: Item[] = [];
  const lens: number[] = [];
  for (const sh of shapes) {
    if (sh.kind !== 'region') continue;
    const path = bridgedPath(regionRings(sh, H));
    if (path.length < 6) continue;
    for (let i = 0; i < path.length; i += 2) {
      xs.push(path[i]);
      ys.push(path[i + 1]);
    }
    lens.push(path.length / 2);
  }
  return { xs, ys, lens };
}

export function buildVideoGraph(frames: TraceResult[], opts: VideoBuildOptions): BuiltVideo {
  if (frames.length === 0) throw new Error('No frames to build');
  const W = frames[0].width;
  const H = frames[0].height;
  const N = frames.length;
  const fill = frames[0].mode === 'fill';
  const unit = opts.decimals !== undefined ? Number((10 ** -opts.decimals).toFixed(opts.decimals)) : coordUnit(W, H);

  const chunks: ChunkAcc[] = [];
  const fresh = (): ChunkAcc => ({ xs: ['u'], ys: ['u'], segs: 0, starts: [1], ends: [1] });
  let cur = fresh();
  chunks.push(cur);
  const placement: (Placement | null)[] = [];
  let repeated = 0;

  frames.forEach((fr, f) => {
    if (f > 0 && fr === frames[f - 1]) {
      placement.push(placement[f - 1]);
      repeated++;
      return;
    }
    if (fill) {
      const data = fillFrame(fr.shapes, H);
      let { xs, ys, lens } = data;
      if (xs.length > CHUNK_CAP - 1) {
        // A single frame larger than a list: keep whole regions that fit (the budget normally prevents this).
        let n = 0, keep = 0;
        while (keep < lens.length && n + lens[keep] <= CHUNK_CAP - 1) n += lens[keep++];
        lens = lens.slice(0, keep);
        xs = xs.slice(0, n);
        ys = ys.slice(0, n);
      }
      if (lens.length === 0) {
        placement.push(null);
        return;
      }
      if (cur.xs.length + xs.length > CHUNK_CAP) {
        cur = fresh();
        chunks.push(cur);
      }
      const first = cur.starts.length + 1; // region index, 1-based
      let p = cur.xs.length + 1;
      for (const len of lens) {
        cur.starts.push(p);
        cur.ends.push(p + len - 1);
        p += len;
      }
      cur.xs.push(...xs);
      cur.ys.push(...ys);
      placement.push({ chunk: chunks.length - 1, a: first, b: first + lens.length - 1 });
      return;
    }
    const data = outlineFrame(fr.shapes, H);
    let { xs, ys } = data;
    if (xs.length === 0) {
      placement.push(null);
      return;
    }
    if (xs.length > CHUNK_CAP - 1) {
      // A single frame larger than a list: keep what fits (the budget normally prevents this).
      const keep = CHUNK_CAP - 1 - ((CHUNK_CAP - 2) % 3);
      xs = xs.slice(0, keep);
      ys = ys.slice(0, keep);
    }
    if (cur.xs.length + xs.length > CHUNK_CAP) {
      cur = fresh();
      chunks.push(cur);
    }
    const a = cur.xs.length + 1; // 1-based
    cur.xs.push(...xs);
    cur.ys.push(...ys);
    const segs = Math.floor((xs.length - 1) / 3);
    cur.segs += segs;
    placement.push({ chunk: chunks.length - 1, a, b: segs - 1 });
  });

  const state = emptyState(imageViewport(W, H));
  const items: DesmosItem[] = [];
  const entries: InspectorEntry[] = [];
  const seconds = N / opts.fps;

  items.push({
    type: 'text',
    id: 'm2d-head',
    text:
      `${opts.name ? opts.name + ' | ' : ''}Made with Media to Desmos (mediatodesmos.github.io). ` +
      `${N} frames at ${num(opts.fps)} fps. Press play on the ticker (the clock icon at the top of this list), or drag F to scrub.`,
  });
  items.push({
    type: 'expression',
    id: 'F',
    color: INK,
    latex: 'F=1',
    slider: { hardMin: true, hardMax: true, min: '1', max: String(N), step: '1' },
  });
  entries.push({
    id: 'F',
    kind: 'slider',
    title: 'Frame slider F',
    summary: `Frames 1 to ${N} at ${num(opts.fps)} fps (${seconds.toFixed(1)} s of video)`,
    explain:
      'F is the number of the frame on screen. Every draw expression below reads F, so changing it swaps the whole picture. ' +
      'Drag it to scrub, or let the ticker step it forward.',
    latex: 'F=1',
  });

  items.push({ type: 'folder', id: 'm2d-data', title: 'Frame data (lists of numbers, open to inspect)', collapsed: true });
  items.push({ type: 'expression', id: UNDEF_ID, folderId: 'm2d-data', latex: UNDEF_VAR });
  if (!fill) items.push({ type: 'expression', id: BEZIER_FN_ID, folderId: 'm2d-data', latex: BEZIER_FN });

  const outChunks: VideoChunk[] = [];
  chunks.forEach((ch, idx) => {
    const c = idx + 1;
    const U: number[] = [], V: number[] = [];
    const framesHere: number[] = [];
    for (let f = 0; f < N; f++) {
      const p = placement[f];
      if (p && p.chunk === idx) {
        U.push(p.a);
        V.push(p.b);
        framesHere.push(f + 1);
      } else {
        U.push(1);
        V.push(fill ? 1 : 0);
      }
    }
    if (!framesHere.length) return;
    const a = Math.min(...framesHere), b = Math.max(...framesHere);
    const second = fill ? `V_{${c}}` : `N_{${c}}`;
    const dataIds = [`u${c}`, `v${c}`, `x${c}`, `y${c}`];
    items.push({ type: 'expression', id: `u${c}`, folderId: 'm2d-data', latex: `U_{${c}}=${packedList(U, 0)}` });
    items.push({ type: 'expression', id: `v${c}`, folderId: 'm2d-data', latex: `${second}=${packedList(V, 0)}` });
    const X = fill ? `X_{p${c}}` : xName(c);
    const Y = fill ? `Y_{p${c}}` : yName(c);
    items.push({ type: 'expression', id: `x${c}`, folderId: 'm2d-data', latex: `${X}=${unitList(ch.xs, unit)}` });
    items.push({ type: 'expression', id: `y${c}`, folderId: 'm2d-data', latex: `${Y}=${unitList(ch.ys, unit)}` });
    if (!fill) {
      items.push({ type: 'expression', id: `p${c}`, folderId: 'm2d-data', latex: pointFn(c, unit) });
      dataIds.push(`p${c}`);
    } else {
      items.push({ type: 'expression', id: `s${c}`, folderId: 'm2d-data', latex: `S_{p${c}}=${packedList(ch.starts, 0)}` });
      items.push({ type: 'expression', id: `e${c}`, folderId: 'm2d-data', latex: `E_{p${c}}=${packedList(ch.ends, 0)}` });
      dataIds.push(`s${c}`, `e${c}`);
    }
    const drawId = `d${c}`;
    let latex: string;
    if (fill) {
      // One polygon per region of frame F: regions U[F]...V[F], region j's points S[j]...E[j].
      const idx = `\\left[S_{p${c}}\\left[j\\right]...E_{p${c}}\\left[j\\right]\\right]`;
      const ut = unitTimes(unit);
      latex =
        `\\left[${polygonLatex(`${ut}${X}${idx}`, `${ut}${Y}${idx}`)}` +
        `\\operatorname{for}j=\\left[U_{${c}}\\left[F\\right]...V_{${c}}\\left[F\\right]\\right]\\right]`;
      items.push({ type: 'expression', id: drawId, color: INK, latex, fillOpacity: '1', lines: false, lineOpacity: '1' });
    } else {
      // "3\cdot": a list right after a number would be read as indexing the number.
      latex = `${pName(c)}\\left(t,U_{${c}}\\left[F\\right]+3\\cdot\\left[0...N_{${c}}\\left[F\\right]\\right]\\right)`;
      items.push({ type: 'expression', id: drawId, color: INK, latex, lineWidth: String(opts.strokeWidth), lineOpacity: '1' });
    }
    const amount = fill ? `${(ch.xs.length - 1).toLocaleString('en-US')} points` : `${ch.segs.toLocaleString('en-US')} Bezier segments`;
    entries.push({
      id: drawId,
      kind: 'draw',
      title: chunks.length > 1 ? `Draw frames ${a} to ${b}` : 'Draw the current frame',
      summary: `${fill ? 'Filled polygon' : 'Bezier curves'} for frames ${a} to ${b}: ${amount} stored in chunk ${c}`,
      explain: fill
        ? `Draws frame F. U_${c}[F] and V_${c}[F] are the first and last region numbers of frame F, and S_p${c}[j], E_p${c}[j] say where region j's outline ` +
          `starts and ends in X_p${c} and Y_p${c}. The "for j" list builds one polygon() per region of the frame; holes run the opposite way and are joined by ` +
          `zero-width bridges, so they stay empty. When F belongs to another chunk, both indexes point at region 1, which is undefined, so this expression draws nothing.`
        : `Draws frame F. U_${c}[F] is where frame F's first Bezier segment starts in the point lists X_${c} and Y_${c}, and N_${c}[F] + 1 is how many ` +
          `segments it has. U + 3[0...N] lists every segment start (neighbouring segments share end points, so starts are 3 apart), and P_${c} draws ` +
          `each one with the Bezier function B. Separate strokes are split by two undefined fillers (u), so the joins between them draw nothing. ` +
          `When F belongs to another chunk, U points at item 1, which is undefined, so this expression draws nothing.`,
      latex,
      related: dataIds,
    });
    entries.push({
      id: `u${c}`,
      kind: 'data',
      title: `Chunk ${c} data`,
      summary: `${(ch.xs.length).toLocaleString('en-US')} points for frames ${a} to ${b}, plus the per-frame indexes`,
      explain: fill
        ? `X_p${c} and Y_p${c} hold every polygon point of frames ${a} to ${b}, frame after frame. U_${c} and V_${c} record where each frame starts and ends.`
        : `X_${c} and Y_${c} hold the Bezier control points of frames ${a} to ${b}: each stroke is its start point followed by 3 points per segment ` +
          `(two pulls and the end, which is the next segment's start). U_${c} and N_${c} record where each frame starts and how many segments it has.`,
      latex: `U_{${c}}=${packedList(U.slice(0, 12), 0)}...`,
      related: dataIds,
    });
    outChunks.push({ index: c, firstFrame: a, lastFrame: b, items: fill ? ch.xs.length - 1 : ch.segs });
  });

  const stepMs = Math.max(1, Math.round(1000 / opts.fps));
  state.expressions.list = items;
  state.expressions.ticker = {
    handlerLatex: `F\\to\\operatorname{mod}\\left(F,${N}\\right)+1`,
    minStepLatex: String(stepMs),
    open: true,
    playing: false,
  };
  entries.splice(1, 0, {
    id: 'm2d-ticker',
    kind: 'ticker',
    title: 'Ticker (playback)',
    summary: `Runs F -> mod(F, ${N}) + 1 every ${stepMs} ms`,
    explain:
      `A Desmos ticker repeats an action on a timer. This action moves F to the next frame and wraps back to 1 after frame ${N}. ` +
      `${stepMs} ms per step is ${num(opts.fps)} fps. Big frames may draw more slowly than that, and Desmos then skips ahead as fast as it can.` +
      (repeated ? ` ${repeated} held frame${repeated === 1 ? '' : 's'} reuse the previous frame's data, which keeps the graph smaller.` : ''),
    latex: state.expressions.ticker.handlerLatex,
  });

  const w = stateWeight(state);
  return {
    state,
    entries,
    width: W,
    height: H,
    bytes: w.bytes,
    expressions: w.expressions,
    frames: N,
    fps: opts.fps,
    chunks: outChunks,
    kind: fill ? 'fill' : 'outline',
    repeated,
  };
}
