/**
 * Built-in samples, drawn procedurally so the site ships no third-party
 * media: a "night landscape" still and a short animated clip.
 */

import type { RgbaImage } from '../pipeline/types';
import type { VideoSource } from './video';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return [c, g];
}

/** A crescent moon over mountains, a pine tree, birds and a lettered sign. */
export function drawSampleImage(w = 960, h = 640): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const s = w / 960;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#111';
  g.strokeStyle = '#111';
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Crescent moon
  g.beginPath();
  g.arc(735 * s, 140 * s, 78 * s, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(770 * s, 118 * s, 70 * s, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';

  // Stars (small four-point sparkles)
  const star = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = k % 2 === 0 ? r : r * 0.32;
      g.lineTo((x + Math.cos(a) * rr) * s, (y + Math.sin(a) * rr) * s);
    }
    g.closePath();
    g.fill();
  };
  star(560, 90, 16);
  star(870, 250, 12);
  star(470, 190, 10);
  star(640, 270, 9);

  // Mountains
  g.beginPath();
  g.moveTo(0, 470 * s);
  g.lineTo(160 * s, 300 * s);
  g.lineTo(250 * s, 380 * s);
  g.lineTo(390 * s, 210 * s);
  g.lineTo(520 * s, 360 * s);
  g.lineTo(610 * s, 300 * s);
  g.lineTo(760 * s, 440 * s);
  g.lineTo(960 * s, 330 * s);
  g.lineTo(960 * s, 640 * s);
  g.lineTo(0, 640 * s);
  g.closePath();
  g.fill();
  // Snow caps (paper-coloured cut-outs)
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(390 * s, 210 * s);
  g.lineTo(432 * s, 258 * s);
  g.lineTo(405 * s, 250 * s);
  g.lineTo(390 * s, 270 * s);
  g.lineTo(372 * s, 248 * s);
  g.lineTo(350 * s, 258 * s);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(160 * s, 300 * s);
  g.lineTo(190 * s, 332 * s);
  g.lineTo(166 * s, 326 * s);
  g.lineTo(150 * s, 340 * s);
  g.lineTo(136 * s, 326 * s);
  g.closePath();
  g.fill();

  // Lake reflection lines
  g.strokeStyle = '#fff';
  g.lineWidth = 6 * s;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo((300 + i * 40) * s, (560 + i * 18) * s);
    g.lineTo((520 - i * 30) * s, (560 + i * 18) * s);
    g.stroke();
  }

  // Pine tree (paper cut-out on the mountain)
  g.fillStyle = '#fff';
  const tx = 120 * s, ty = 600 * s;
  g.beginPath();
  g.moveTo(tx, ty - 230 * s);
  for (let k = 0; k < 4; k++) {
    const y = ty - 230 * s + (k + 1) * 50 * s;
    const half = (34 + k * 16) * s;
    g.lineTo(tx + half, y);
    g.lineTo(tx + half * 0.45, y);
  }
  g.lineTo(tx + 10 * s, ty - 20 * s);
  g.lineTo(tx + 10 * s, ty);
  g.lineTo(tx - 10 * s, ty);
  g.lineTo(tx - 10 * s, ty - 20 * s);
  for (let k = 3; k >= 0; k--) {
    const y = ty - 230 * s + (k + 1) * 50 * s;
    const half = (34 + k * 16) * s;
    g.lineTo(tx - half * 0.45, y);
    g.lineTo(tx - half, y);
  }
  g.closePath();
  g.fill();

  // Birds (stroked gull shapes)
  g.strokeStyle = '#111';
  g.lineWidth = 5 * s;
  const bird = (x: number, y: number, r: number) => {
    g.beginPath();
    g.moveTo((x - r) * s, y * s);
    g.quadraticCurveTo((x - r / 2) * s, (y - r * 0.7) * s, x * s, y * s);
    g.quadraticCurveTo((x + r / 2) * s, (y - r * 0.7) * s, (x + r) * s, y * s);
    g.stroke();
  };
  bird(200, 120, 34);
  bird(270, 160, 24);
  bird(150, 190, 20);

  // Lettering, cut out of the dark foreground (tests holes in fill mode)
  g.fillStyle = '#fff';
  g.font = `600 ${58 * s}px Newsreader, Georgia, serif`;
  g.textBaseline = 'alphabetic';
  g.fillText('y = f(x)', 600 * s, 560 * s);
  return c;
}

export function sampleImageFile(): Promise<File> {
  const c = drawSampleImage();
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(new File([b], 'sample-landscape.png', { type: 'image/png' })) : reject(new Error('Could not draw the sample'))), 'image/png'),
  );
}

/** A 4-second procedural clip: a bouncing ball, a turning star and a walking stick figure. */
export class SampleVideo implements VideoSource {
  name = 'sample-animation (procedural)';
  duration = 4;
  width = 640;
  height = 360;
  nativeFps = 24;

  drawFrame(t: number, w = this.width, h = this.height): HTMLCanvasElement {
    const [c, g] = canvas(w, h);
    const s = w / 640;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    g.strokeStyle = '#111';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // Ground
    g.fillRect(0, 300 * s, w, 60 * s);
    // Bouncing ball
    const phase = (t * 1.25) % 1;
    const by = 300 - 26 - Math.abs(Math.sin(phase * Math.PI)) * 190;
    const bx = 80 + ((t / this.duration) * 480) % 480;
    const squash = phase < 0.08 || phase > 0.92 ? 0.8 : 1;
    g.beginPath();
    g.ellipse(bx * s, by * s, (26 / squash) * s, 26 * squash * s, 0, 0, Math.PI * 2);
    g.fill();
    // Turning star
    g.save();
    g.translate(540 * s, 90 * s);
    g.rotate(t * 1.6);
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const r = (k % 2 === 0 ? 46 : 19) * s;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.restore();
    // Stick figure walking
    const fx = (40 + t * 60) * s;
    const step = Math.sin(t * Math.PI * 3);
    g.lineWidth = 7 * s;
    g.beginPath();
    g.arc(fx, 196 * s, 16 * s, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(fx, 212 * s);
    g.lineTo(fx, 256 * s);
    g.moveTo(fx, 256 * s);
    g.lineTo(fx + step * 18 * s, 296 * s);
    g.moveTo(fx, 256 * s);
    g.lineTo(fx - step * 18 * s, 296 * s);
    g.moveTo(fx, 226 * s);
    g.lineTo(fx - step * 20 * s, 248 * s);
    g.moveTo(fx, 226 * s);
    g.lineTo(fx + step * 20 * s, 248 * s);
    g.stroke();
    return c;
  }

  async frameAt(time: number, longSide: number): Promise<RgbaImage> {
    const scale = longSide / Math.max(this.width, this.height);
    const w = Math.max(1, Math.round(this.width * scale));
    const h = Math.max(1, Math.round(this.height * scale));
    const c = this.drawFrame(time, w, h);
    const id = c.getContext('2d')!.getImageData(0, 0, w, h);
    return { width: w, height: h, data: id.data };
  }

  dispose(): void {}
}
