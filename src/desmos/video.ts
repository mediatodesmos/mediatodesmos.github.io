/**
 * A whole video as ONE Desmos graph:
 *   - slider F = current frame (1..N)
 *   - every frame's Bezier segments (or polygon points) concatenated into
 *     lists, split into chunks of at most 10,000 items (Desmos' list limit)
 *   - per chunk, index lists U_c / V_c give frame F's first / last position
 *   - one draw expression per chunk slices X[U_c[F]...V_c[F]]
 *   - a ticker advances F at the video's frame rate
 * Item 1 of every data list is undefined: frames that live in another chunk
 * point U = V = 1, so that chunk draws nothing.
 */

import type { Shape, TraceResult } from '../pipeline/types';
import { INK, bridgedPath, regionRings, strokeColumns, type BuiltGraph, type InspectorEntry } from './build';
import { UNDEF, bezierLatex, list, num, polygonLatex, slice } from './latex';
import { emptyState, imageViewport, stateWeight, type DesmosItem } from './state';

/** Max data items per chunk list, leaving room for the undefined placeholder. */
export const CHUNK_CAP = 9999;

export interface VideoBuildOptions {
  fps: number;
  strokeWidth: number;
  name?: string;
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
}

interface ChunkAcc {
  cols: number[][];
  frames: Map<number, [number, number]>;
  first: number;
  last: number;
  count: number;
}

function frameSegments(shapes: Shape[]): number[] {
  const out: number[] = [];
  for (const sh of shapes) if (sh.kind === 'stroke') for (const v of sh.segs) out.push(v);
  return out;
}

function framePolygon(shapes: Shape[], H: number): number[] {
  const rings: { pts: number[]; hole: boolean }[] = [];
  for (const sh of shapes) if (sh.kind === 'region') rings.push(...regionRings(sh, H));
  return bridgedPath(rings);
}

export function buildVideoGraph(frames: TraceResult[], opts: VideoBuildOptions): BuiltVideo {
  if (frames.length === 0) throw new Error('No frames to build');
  const W = frames[0].width;
  const H = frames[0].height;
  const N = frames.length;
  const fill = frames[0].mode === 'fill';
  const ncols = fill ? 2 : 8;

  const chunks: ChunkAcc[] = [];
  const fresh = (f: number): ChunkAcc => ({ cols: Array.from({ length: ncols }, () => []), frames: new Map(), first: f, last: f, count: 0 });
  let cur = fresh(0);

  frames.forEach((fr, f) => {
    let rows: number[][]; // rows[col] values for this frame
    if (fill) {
      const path = framePolygon(fr.shapes, H);
      const xs: number[] = [], ys: number[] = [];
      for (let i = 0; i < path.length; i += 2) {
        xs.push(path[i]);
        ys.push(path[i + 1]);
      }
      rows = [xs, ys];
    } else {
      rows = strokeColumns(frameSegments(fr.shapes), H);
    }
    let n = rows[0].length;
    if (n > CHUNK_CAP) {
      rows = rows.map((r) => r.slice(0, CHUNK_CAP));
      n = CHUNK_CAP;
    }
    if (cur.count + n > CHUNK_CAP && cur.count > 0) {
      chunks.push(cur);
      cur = fresh(f);
    }
    if (n > 0) {
      const u = cur.count + 2; // 1-based, after the placeholder
      for (let c = 0; c < ncols; c++) for (const v of rows[c]) cur.cols[c].push(v);
      cur.count += n;
      cur.frames.set(f, [u, u + n - 1]);
    }
    cur.last = f;
  });
  if (cur.count > 0 || chunks.length === 0) chunks.push(cur);

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

  const names = (c: number) =>
    fill ? [`P_{x${c}}`, `P_{y${c}}`] : ['a', 'b', 'c', 'd'].map((s) => `X_{${s}${c}}`).concat(['a', 'b', 'c', 'd'].map((s) => `Y_{${s}${c}}`));

  const outChunks: VideoChunk[] = [];
  chunks.forEach((ch, idx) => {
    const c = idx + 1;
    const U: number[] = [], V: number[] = [];
    for (let f = 0; f < N; f++) {
      const r = ch.frames.get(f);
      U.push(r ? r[0] : 1);
      V.push(r ? r[1] : 1);
    }
    const nm = names(c);
    const dataIds: string[] = [`u${c}`, `v${c}`];
    items.push({ type: 'expression', id: `u${c}`, folderId: 'm2d-data', latex: `U_{${c}}=${list(U, 0)}` });
    items.push({ type: 'expression', id: `v${c}`, folderId: 'm2d-data', latex: `V_{${c}}=${list(V, 0)}` });
    nm.forEach((name, k) => {
      const id = `l${c}_${k}`;
      dataIds.push(id);
      items.push({ type: 'expression', id, folderId: 'm2d-data', latex: `${name}=${list([UNDEF, ...ch.cols[k]])}` });
    });
    const sl = (name: string) => slice(name, `U_{${c}}`, `V_{${c}}`);
    const drawId = `d${c}`;
    const framesWithData = Array.from(ch.frames.keys());
    const a = (framesWithData.length ? Math.min(...framesWithData) : ch.first) + 1;
    const b = (framesWithData.length ? Math.max(...framesWithData) : ch.last) + 1;
    let latex: string;
    if (fill) {
      latex = polygonLatex(sl(nm[0]), sl(nm[1]));
      items.push({ type: 'expression', id: drawId, color: INK, latex, fillOpacity: '1', lines: false, lineOpacity: '1' });
    } else {
      latex = bezierLatex(...(nm.map(sl) as [string, string, string, string, string, string, string, string]));
      items.push({
        type: 'expression',
        id: drawId,
        color: INK,
        latex,
        lineWidth: String(opts.strokeWidth),
        lineOpacity: '1',
        parametricDomain: { min: '0', max: '1' },
      });
    }
    entries.push({
      id: drawId,
      kind: 'draw',
      title: chunks.length > 1 ? `Draw frames ${a} to ${b}` : 'Draw the current frame',
      summary: `${fill ? 'Filled polygon' : 'Bezier curves'} for frames ${a} to ${b}: ${ch.count.toLocaleString('en-US')} ${fill ? 'points' : 'segments'} stored in chunk ${c}`,
      explain:
        `Draws frame F. U_${c}[F] and V_${c}[F] are the first and last positions of frame F's data inside chunk ${c}, and the slice ` +
        `list[U...V] picks out only those items. ` +
        (fill
          ? 'polygon() then fills the outlines of that frame. Holes are joined by zero-width bridges and run the opposite way, so they stay empty. '
          : 'The Bezier formula is applied to every selected segment at once. ') +
        `When F belongs to another chunk, both indexes point at item 1, which is undefined, so this expression draws nothing.`,
      latex,
      related: dataIds,
    });
    entries.push({
      id: `u${c}`,
      kind: 'data',
      title: `Chunk ${c} data`,
      summary: `${nm.length + 2} lists: ${nm.length} with ${ch.count.toLocaleString('en-US')} numbers each, plus the U/V indexes for all ${N} frames`,
      explain: fill
        ? `P_x and P_y hold the x and y of every polygon point in frames ${a} to ${b}, frame after frame. U_${c} and V_${c} record where each frame starts and ends.`
        : `The X lists hold the x coordinates and the Y lists the y coordinates of each segment's start point (a), two control points (b, c) and end point (d), ` +
          `for every segment in frames ${a} to ${b}. U_${c} and V_${c} record where each frame starts and ends.`,
      latex: `U_{${c}}=${list(U.slice(0, 12), 0)}...`,
      related: dataIds,
    });
    outChunks.push({ index: c, firstFrame: a, lastFrame: b, items: ch.count });
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
      `${stepMs} ms per step is ${num(opts.fps)} fps. Big frames may draw more slowly than that, and Desmos then skips ahead as fast as it can.`,
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
  };
}
