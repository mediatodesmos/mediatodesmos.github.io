/**
 * Desmos graph-state types (version 11), as produced by
 * GraphingCalculator.getState() and accepted by setState() on desmos.com.
 * Verified against the live API in the spike.
 */

export interface DesmosExpression {
  type: 'expression';
  id: string;
  latex: string;
  color?: string;
  folderId?: string;
  hidden?: boolean;
  secret?: boolean;
  lines?: boolean;
  points?: boolean;
  fill?: boolean;
  fillOpacity?: string;
  lineOpacity?: string;
  lineWidth?: string;
  parametricDomain?: { min: string; max: string };
  domain?: { min: string; max: string };
  slider?: {
    hardMin?: boolean;
    hardMax?: boolean;
    min?: string;
    max?: string;
    step?: string;
    isPlaying?: boolean;
    animationPeriod?: number;
    loopMode?: string;
  };
}

export interface DesmosFolder {
  type: 'folder';
  id: string;
  title: string;
  collapsed?: boolean;
  hidden?: boolean;
  folderId?: string;
}

export interface DesmosText {
  type: 'text';
  id: string;
  text: string;
  folderId?: string;
}

export type DesmosItem = DesmosExpression | DesmosFolder | DesmosText;

export interface DesmosTicker {
  handlerLatex: string;
  minStepLatex: string;
  open?: boolean;
  playing?: boolean;
}

export interface Viewport {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface DesmosState {
  version: 11;
  randomSeed: string;
  graph: {
    viewport: Viewport;
    showGrid?: boolean;
    showXAxis?: boolean;
    showYAxis?: boolean;
    xAxisNumbers?: boolean;
    yAxisNumbers?: boolean;
    polarNumbers?: boolean;
  };
  expressions: {
    list: DesmosItem[];
    ticker?: DesmosTicker;
  };
}

export function emptyState(viewport: Viewport): DesmosState {
  return {
    version: 11,
    randomSeed: randomSeed(),
    graph: {
      viewport,
      showGrid: false,
      showXAxis: false,
      showYAxis: false,
      xAxisNumbers: false,
      yAxisNumbers: false,
      polarNumbers: false,
    },
    expressions: { list: [] },
  };
}

function randomSeed(): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** A viewport showing a w x h image (Desmos coords: x 0..w, y 0..h) with a small margin. */
export function imageViewport(w: number, h: number, margin = 0.04): Viewport {
  const mx = w * margin, my = h * margin;
  return { xmin: -mx, xmax: w + mx, ymin: -my, ymax: h + my };
}

/** Total LaTeX characters: a good proxy for graph size. */
export function stateWeight(state: DesmosState): { bytes: number; expressions: number } {
  let bytes = 0;
  let expressions = 0;
  for (const item of state.expressions.list) {
    if (item.type === 'expression') {
      bytes += item.latex.length;
      expressions++;
    } else if (item.type === 'text') bytes += item.text.length;
  }
  return { bytes, expressions };
}
