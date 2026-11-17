/**
 * The picture editor, one canvas with three modes:
 *   - draw:   pen, eraser, line, rectangle, ellipse, fill bucket, text (with
 *             font import), drawn over the picture (or a blank page)
 *   - mask:   touch up the background cut-out with Keep and Remove brushes
 *   - detail: paint the areas that should get extra detail
 * Wheel zooms, the hand tool / space-drag / middle-drag pans. Ctrl+Z / Ctrl+Y
 * undo and redo. Nothing changes until Done.
 */

import '../../../styles/editor.css';
import { el, mount, prefersReducedMotion } from '../../../ui/dom';
import { button, iconButton, select, slider, toast, toggle } from '../../../ui/components';
import type { IconName } from '../../../ui/icons';
import type { SourceLayers, BgOptions, MaskEdit } from '../layers';
import { BUILTIN_FONTS, renderOps, smoothPath, type DetailStroke, type DrawOp } from './ops';

export type EditorMode = 'draw' | 'mask' | 'detail';

type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'text' | 'hand' | 'keep' | 'remove' | 'paint' | 'unpaint';

const TOOLS: Record<EditorMode, { tool: Tool; icon: IconName; label: string; key: string }[]> = {
  draw: [
    { tool: 'pen', icon: 'pen', label: 'Pen', key: 'p' },
    { tool: 'eraser', icon: 'eraser', label: 'Eraser (removes drawing only)', key: 'e' },
    { tool: 'line', icon: 'line', label: 'Line', key: 'l' },
    { tool: 'rect', icon: 'square', label: 'Rectangle', key: 'r' },
    { tool: 'ellipse', icon: 'circle', label: 'Ellipse', key: 'o' },
    { tool: 'fill', icon: 'bucket', label: 'Fill bucket', key: 'f' },
    { tool: 'text', icon: 'type', label: 'Text', key: 't' },
    { tool: 'hand', icon: 'hand', label: 'Move the view', key: 'h' },
  ],
  mask: [
    { tool: 'keep', icon: 'brush-plus', label: 'Keep: paint back what should stay', key: 'k' },
    { tool: 'remove', icon: 'brush-minus', label: 'Remove: paint away leftover background', key: 'r' },
    { tool: 'hand', icon: 'hand', label: 'Move the view', key: 'h' },
  ],
  detail: [
    { tool: 'paint', icon: 'brush', label: 'Paint more detail', key: 'b' },
    { tool: 'unpaint', icon: 'eraser', label: 'Erase painted detail', key: 'e' },
    { tool: 'hand', icon: 'hand', label: 'Move the view', key: 'h' },
  ],
};

const TITLES: Record<EditorMode, { title: string; hint: string }> = {
  draw: { title: 'Draw on your picture', hint: 'Everything you draw is traced with the picture, in every style.' },
  mask: { title: 'Touch up the cut-out', hint: 'Keep paints the subject back in, Remove clears leftover background.' },
  detail: { title: 'Detail brush', hint: 'Painted areas get more equations: finer lines and smaller shapes are kept there.' },
};

/** Fonts imported this session (family names), shared by every editor. */
const importedFonts: string[] = [];

/** Load a user font file through the FontFace API; returns its family name. */
export async function importFont(file: File): Promise<string> {
  const base = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').replace(/[^\w -]+/g, ' ').trim() || 'Custom font';
  let name = base;
  for (let i = 2; importedFonts.includes(name) || BUILTIN_FONTS.includes(name); i++) name = `${base} ${i}`;
  const face = new FontFace(name, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  importedFonts.push(name);
  return name;
}

interface Snapshot {
  ops: DrawOp[];
  edits: MaskEdit[];
  detail: DetailStroke[];
}

export interface EditorOptions {
  mode: EditorMode;
  layers: SourceLayers;
  bg: BgOptions;
  onDone: () => void;
}

export function openEditor(opts: EditorOptions): void {
  const { layers, mode } = opts;
  const W = layers.width, H = layers.height, L = Math.max(W, H);
  let state: Snapshot = { ops: structuredClone(layers.ops), edits: structuredClone(layers.edits), detail: structuredClone(layers.detail) };
  const undo: Snapshot[] = [];
  const redo: Snapshot[] = [];
  const commit = (next: Snapshot) => {
    undo.push(state);
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    state = next;
    invalidate();
    syncHistory();
  };

  let tool: Tool = TOOLS[mode][0].tool;
  let color = '#111111';
  let width = 0.006; // fraction of long side
  let brush = 0.025;
  let shapeFill = false;
  let tolerance = 24;
  let font = BUILTIN_FONTS[0];
  let fontSize = 0.06;

  // ------------------------------------------------------------ layout
  const canvas = el('canvas', { class: 'ed-canvas', attrs: { 'aria-label': TITLES[mode].title } });
  const stage = el('div', { class: 'ed-stage' }, canvas);
  const undoBtn = iconButton({ icon: 'undo', title: 'Undo (Ctrl+Z)', onClick: () => doUndo() });
  const redoBtn = iconButton({ icon: 'redo', title: 'Redo (Ctrl+Y)', onClick: () => doRedo() });
  const toolRail = el('div', { class: 'ed-tools', attrs: { role: 'toolbar', 'aria-label': 'Tools' } });
  const optionsBar = el('div', { class: 'ed-options' });
  const head = el(
    'header',
    { class: 'ed-head' },
    el('div', { class: 'ed-titles' }, el('h2', { class: 'ed-title' }, TITLES[mode].title), el('p', { class: 'ed-hint' }, TITLES[mode].hint)),
    el(
      'div',
      { class: 'ed-actions' },
      undoBtn,
      redoBtn,
      button({ label: 'Clear', icon: 'trash', variant: 'ghost', size: 'sm', onClick: () => clearAll() }),
      button({ label: 'Cancel', variant: 'outline', size: 'sm', onClick: () => close(false) }),
      button({ label: 'Done', icon: 'check', variant: 'primary', size: 'sm', onClick: () => close(true) }),
    ),
  );
  const root = el(
    'div',
    { class: 'ed', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': TITLES[mode].title } },
    head,
    el('div', { class: 'ed-body' }, toolRail, el('div', { class: 'ed-main' }, optionsBar, stage)),
  );
  document.body.appendChild(root);
  document.body.classList.add('has-editor');

  function syncHistory(): void {
    (undoBtn as HTMLButtonElement).disabled = undo.length === 0;
    (redoBtn as HTMLButtonElement).disabled = redo.length === 0;
  }

  function renderTools(): void {
    mount(
      toolRail,
      ...TOOLS[mode].map((t) => {
        const b = iconButton({ icon: t.icon, title: `${t.label} (${t.key.toUpperCase()})`, active: t.tool === tool, onClick: () => setTool(t.tool) });
        b.classList.toggle('is-active', t.tool === tool);
        b.setAttribute('aria-pressed', String(t.tool === tool));
        return b;
      }),
    );
  }

  function setTool(t: Tool): void {
    tool = t;
    canvas.dataset.tool = t;
    renderTools();
    renderOptions();
  }

  function colorControl(): HTMLElement {
    const input = el('input', { type: 'color', value: color, class: 'ed-color-input', attrs: { 'aria-label': 'Colour' } });
    input.addEventListener('input', () => (color = input.value));
    const quick = ['#111111', '#ffffff', '#d33a2c', '#f2b01e', '#2f9e44', '#2f6fed', '#7048e8'];
    return el(
      'div',
      { class: 'ed-colors' },
      ...quick.map((c) =>
        el('button', {
          type: 'button',
          class: 'swatch ed-swatch',
          style: { background: c },
          title: c,
          attrs: { 'aria-label': `Colour ${c}` },
          on: {
            click: () => {
              color = c;
              input.value = c;
            },
          },
        }),
      ),
      el('label', { class: 'ed-color-pick', title: 'Any colour' }, input),
    );
  }

  function renderOptions(): void {
    const parts: (HTMLElement | null)[] = [];
    const sizeSlider = (label: string, get: () => number, set: (v: number) => void, max = 0.08) =>
      slider({
        label,
        min: 1,
        max: Math.round(max * 1000),
        step: 1,
        value: Math.round(get() * 1000),
        format: (v) => `${Math.max(1, Math.round((v / 1000) * L))} px`,
        onInput: (v) => set(v / 1000),
      }).el;
    if (tool === 'pen' || tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      parts.push(colorControl(), sizeSlider('Line width', () => width, (v) => (width = v), 0.04));
      if (tool === 'rect' || tool === 'ellipse') parts.push(toggle({ label: 'Filled', value: shapeFill, onChange: (v) => (shapeFill = v) }).el);
    } else if (tool === 'eraser') {
      parts.push(sizeSlider('Eraser size', () => width * 3, (v) => (width = v / 3), 0.12));
    } else if (tool === 'fill') {
      parts.push(
        colorControl(),
        slider({ label: 'Tolerance', min: 0, max: 80, step: 1, value: tolerance, onInput: (v) => (tolerance = v), hint: 'How different a colour can be and still fill.' }).el,
      );
    } else if (tool === 'text') {
      const fonts = [...BUILTIN_FONTS, ...importedFonts];
      const fontInput = el('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2,font/*', hidden: true });
      fontInput.addEventListener('change', async () => {
        const f = fontInput.files?.[0];
        if (!f) return;
        try {
          font = await importFont(f);
          toast(`Font "${font}" ready`, { tone: 'success' });
          renderOptions();
        } catch {
          toast('That file is not a font this browser can read (try .ttf, .otf, .woff or .woff2).', { tone: 'error' });
        }
      });
      parts.push(
        colorControl(),
        select({ label: 'Font', options: fonts.map((f) => ({ value: f, label: f })), value: font, onChange: (v) => (font = v) }).el,
        button({ label: 'Import a font', icon: 'font', variant: 'outline', size: 'sm', onClick: () => fontInput.click() }),
        fontInput,
        sizeSlider('Text size', () => fontSize, (v) => (fontSize = v), 0.25),
        el('p', { class: 'field-hint' }, 'Click the picture where the text should start.'),
      );
    } else if (tool === 'keep' || tool === 'remove' || tool === 'paint' || tool === 'unpaint') {
      parts.push(sizeSlider('Brush size', () => brush, (v) => (brush = v), 0.15));
    } else if (tool === 'hand') {
      parts.push(el('p', { class: 'field-hint' }, 'Drag to move. Scroll to zoom. Double-click to fit.'));
    }
    mount(optionsBar, ...parts);
  }

  // ------------------------------------------------------------ view
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let scale = 1, ox = 0, oy = 0;
  const fit = () => {
    const r = stage.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    scale = Math.min(canvas.width / W, canvas.height / H) * 0.94;
    ox = (canvas.width - W * scale) / 2;
    oy = (canvas.height - H * scale) / 2;
    draw();
  };
  const toImage = (e: PointerEvent | MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * dpr - ox) / scale, ((e.clientY - r.top) * dpr - oy) / scale];
  };

  // Cached layers so live strokes stay smooth.
  let picture: HTMLCanvasElement | null = null;
  let opsLayer: HTMLCanvasElement | null = null;
  function invalidate(): void {
    opsLayer = null;
    if (mode !== 'draw') picture = null;
    draw();
  }
  function getPicture(): HTMLCanvasElement {
    if (picture) return picture;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const src = layers.sourceCanvas();
    if (mode === 'mask') {
      // Faded original underneath, the kept part at full strength on top.
      g.globalAlpha = 0.28;
      g.drawImage(src, 0, 0);
      g.globalAlpha = 1;
      const kept = document.createElement('canvas');
      kept.width = W;
      kept.height = H;
      const kg = kept.getContext('2d')!;
      kg.drawImage(src, 0, 0);
      const saved = layers.edits;
      layers.edits = state.edits;
      const m = layers.maskCanvas(opts.bg.feather);
      layers.edits = saved;
      if (m) {
        kg.globalCompositeOperation = 'destination-in';
        kg.drawImage(m, 0, 0);
      }
      g.drawImage(kept, 0, 0);
    } else {
      // Draw and detail modes show the picture as it will be traced (background removed, without the drawing).
      const saved = layers.ops;
      layers.ops = [];
      g.drawImage(layers.compose(opts.bg), 0, 0);
      layers.ops = saved;
    }
    picture = c;
    return c;
  }
  function getOps(): HTMLCanvasElement {
    if (opsLayer) return opsLayer;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    if (mode === 'draw') renderOps(g, state.ops, W, H, getPicture());
    else if (mode === 'detail') {
      g.strokeStyle = 'rgba(47, 111, 237, 0.42)';
      g.fillStyle = g.strokeStyle;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const s of state.detail) strokeOn(g, s.pts, s.r * 2 * L);
    }
    opsLayer = c;
    return c;
  }
  function strokeOn(g: CanvasRenderingContext2D, pts: number[], lw: number): void {
    g.lineWidth = Math.max(1, lw);
    g.beginPath();
    if (pts.length === 2) {
      g.arc(pts[0] * W, pts[1] * H, g.lineWidth / 2, 0, Math.PI * 2);
      g.fill();
      return;
    }
    g.moveTo(pts[0] * W, pts[1] * H);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * W, pts[i + 1] * H);
    g.stroke();
  }

  let live: DrawOp | null = null;
  let liveStroke: { pts: number[]; kind: 'keep' | 'remove' | 'paint' | 'unpaint' } | null = null;
  let cursor: [number, number] | null = null;

  function draw(): void {
    const g = canvas.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(scale, 0, 0, scale, ox, oy);
    // Paper (checkered in mask mode so removed areas read as "gone").
    if (mode === 'mask') {
      const cell = 12 / scale;
      for (let y = 0; y < H; y += cell)
        for (let x = 0; x < W; x += cell) {
          g.fillStyle = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? '#d8d8d8' : '#f4f4f4';
          g.fillRect(x, y, cell + 0.5 / scale, cell + 0.5 / scale);
        }
    } else {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
    }
    g.imageSmoothingQuality = 'high';
    g.drawImage(getPicture(), 0, 0);
    g.drawImage(getOps(), 0, 0);
    if (live) {
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      renderOps(tmp.getContext('2d')!, [live], W, H);
      g.drawImage(tmp, 0, 0);
    }
    if (liveStroke) {
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const c = liveStroke.kind === 'keep' ? 'rgba(47, 158, 68, 0.55)' : liveStroke.kind === 'remove' ? 'rgba(211, 58, 44, 0.55)' : liveStroke.kind === 'paint' ? 'rgba(47, 111, 237, 0.42)' : 'rgba(255,255,255,0.6)';
      g.strokeStyle = c;
      g.fillStyle = c;
      strokeOn(g, liveStroke.pts, brush * 2 * L);
      g.restore();
    }
    // Brush outline under the pointer.
    if (cursor && (tool === 'keep' || tool === 'remove' || tool === 'paint' || tool === 'unpaint' || tool === 'eraser')) {
      g.save();
      g.lineWidth = 1.5 / scale;
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      const rr = tool === 'eraser' ? (width * 3 * L) / 2 : brush * L;
      g.beginPath();
      g.arc(cursor[0], cursor[1], rr, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.arc(cursor[0], cursor[1], rr + 1.5 / scale, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    // Frame around the page.
    g.lineWidth = 1 / scale;
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.strokeRect(0, 0, W, H);
  }

  // ------------------------------------------------------------ input
  let panning: { x: number; y: number; ox: number; oy: number } | null = null;
  let spaceDown = false;
  let start: [number, number] | null = null;

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    const f = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.max(0.05, Math.min(40, scale * f));
    ox = px - ((px - ox) * ns) / scale;
    oy = py - ((py - oy) * ns) / scale;
    scale = ns;
    draw();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    if (tool === 'hand') fit();
  });

  const frac = (p: [number, number]): [number, number] => [Math.max(-0.1, Math.min(1.1, p[0] / W)), Math.max(-0.1, Math.min(1.1, p[1] / H))];

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || tool === 'hand' || spaceDown) {
      panning = { x: e.clientX, y: e.clientY, ox, oy };
      canvas.classList.add('is-panning');
      return;
    }
    if (e.button !== 0) return;
    const p = toImage(e);
    const f = frac(p);
    start = p;
    if (tool === 'pen' || tool === 'eraser') live = { t: 'path', pts: [f[0], f[1]], color, width: tool === 'eraser' ? width * 3 : width, erase: tool === 'eraser' };
    else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') live = { t: tool, a: f, b: f, color, width, fill: shapeFill && tool !== 'line' };
    else if (tool === 'keep' || tool === 'remove' || tool === 'paint' || tool === 'unpaint') liveStroke = { pts: [f[0], f[1]], kind: tool };
    else if (tool === 'fill') {
      commit({ ...state, ops: [...state.ops, { t: 'fill', x: f[0], y: f[1], color, tolerance }] });
    } else if (tool === 'text') {
      openTextBox(e, f);
    }
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    cursor = toImage(e);
    if (panning) {
      ox = panning.ox + (e.clientX - panning.x) * dpr;
      oy = panning.oy + (e.clientY - panning.y) * dpr;
      draw();
      return;
    }
    const f = frac(cursor);
    if (live && live.t === 'path') live.pts.push(f[0], f[1]);
    else if (live && (live.t === 'line' || live.t === 'rect' || live.t === 'ellipse')) {
      let b: [number, number] = f;
      if (e.shiftKey && start) {
        // Shift: squares, circles and 45-degree lines.
        const s0 = frac(start);
        const dx = (f[0] - s0[0]) * W, dy = (f[1] - s0[1]) * H;
        if (live.t === 'line') {
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
          b = [s0[0] + (Math.cos(a) * len) / W, s0[1] + (Math.sin(a) * len) / H];
        } else {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          b = [s0[0] + (Math.sign(dx) * m) / W, s0[1] + (Math.sign(dy) * m) / H];
        }
      }
      live.b = b;
    } else if (liveStroke) liveStroke.pts.push(f[0], f[1]);
    draw();
  });
  const finish = () => {
    if (panning) {
      panning = null;
      canvas.classList.remove('is-panning');
      return;
    }
    if (live) {
      const op = live.t === 'path' ? { ...live, pts: smoothPath(live.pts, 2) } : live;
      live = null;
      commit({ ...state, ops: [...state.ops, op] });
    } else if (liveStroke) {
      const s = liveStroke;
      liveStroke = null;
      const pts = smoothPath(s.pts, 1);
      if (s.kind === 'keep' || s.kind === 'remove') commit({ ...state, edits: [...state.edits, { pts, r: brush, keep: s.kind === 'keep' }] });
      else if (s.kind === 'paint') commit({ ...state, detail: [...state.detail, { pts, r: brush }] });
      else {
        // Unpaint: drop detail strokes the eraser passed over.
        const hit = (d: DetailStroke) => {
          for (let i = 0; i < d.pts.length; i += 2)
            for (let j = 0; j < pts.length; j += 2)
              if (Math.hypot((d.pts[i] - pts[j]) * W, (d.pts[i + 1] - pts[j + 1]) * H) < (brush + d.r) * L) return true;
          return false;
        };
        commit({ ...state, detail: state.detail.filter((d) => !hit(d)) });
      }
    }
    start = null;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', () => {
    cursor = null;
    draw();
  });

  function openTextBox(e: PointerEvent, f: [number, number]): void {
    stage.querySelector('.ed-textbox')?.remove();
    const r = stage.getBoundingClientRect();
    const area = el('textarea', { class: 'ed-text-area', rows: 2, placeholder: 'Type here', attrs: { 'aria-label': 'Text to add' } });
    const add = () => {
      const text = area.value.trim();
      box.remove();
      if (!text) return;
      // (x, y) is the top-left of the first line; text is drawn from its baseline.
      commit({ ...state, ops: [...state.ops, { t: 'text', x: f[0], y: f[1] + fontSize * (L / H), text, size: fontSize, color, font }] });
    };
    const box = el(
      'div',
      { class: 'ed-textbox', style: { left: `${Math.min(r.width - 240, e.clientX - r.left)}px`, top: `${Math.min(r.height - 120, e.clientY - r.top)}px` } },
      area,
      el('div', { class: 'ed-textbox-row' }, button({ label: 'Cancel', variant: 'ghost', size: 'sm', onClick: () => box.remove() }), button({ label: 'Add text', variant: 'primary', size: 'sm', onClick: add })),
    );
    area.style.fontFamily = `"${font}", sans-serif`;
    area.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) add();
      if (ev.key === 'Escape') box.remove();
    });
    stage.appendChild(box);
    area.focus();
  }

  function doUndo(): void {
    const prev = undo.pop();
    if (!prev) return;
    redo.push(state);
    state = prev;
    invalidate();
    syncHistory();
  }
  function doRedo(): void {
    const next = redo.pop();
    if (!next) return;
    undo.push(state);
    state = next;
    invalidate();
    syncHistory();
  }
  function clearAll(): void {
    if (mode === 'draw' && state.ops.length) commit({ ...state, ops: [] });
    else if (mode === 'mask' && state.edits.length) commit({ ...state, edits: [] });
    else if (mode === 'detail' && state.detail.length) commit({ ...state, detail: [] });
  }

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
    if (e.key === ' ') {
      spaceDown = e.type === 'keydown';
      canvas.classList.toggle('is-space', spaceDown);
      e.preventDefault();
      return;
    }
    if (e.type !== 'keydown') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
    } else if (e.key === 'Escape') close(false);
    else if (!mod) {
      const t = TOOLS[mode].find((x) => x.key === e.key.toLowerCase());
      if (t) setTool(t.tool);
    }
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  const ro = new ResizeObserver(() => fit());
  ro.observe(stage);

  function close(save: boolean): void {
    if (save) {
      layers.ops = state.ops;
      layers.edits = state.edits;
      layers.detail = state.detail;
      layers.touch();
    }
    ro.disconnect();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    document.body.classList.remove('has-editor');
    // A short, quiet fade out (skipped when reduced motion is preferred).
    root.classList.add('is-closing');
    if (prefersReducedMotion()) root.remove();
    else setTimeout(() => root.remove(), 160);
    if (save) opts.onDone();
  }

  renderTools();
  renderOptions();
  syncHistory();
  setTool(tool);
  requestAnimationFrame(fit);
}
