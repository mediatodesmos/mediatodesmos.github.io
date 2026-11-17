/**
 * Video sources. A VideoSource hands out frames by time at any working
 * resolution. FileVideo decodes with a hidden <video> and seeks frame by
 * frame. Every browser that plays MP4 can do this, with no WASM needed.
 */

import type { RgbaImage } from '../pipeline/types';
import { rasterize, type CropRect } from './raster';

export interface VideoSource {
  name: string;
  duration: number;
  width: number;
  height: number;
  /** Best guess of the native frame rate (for the UI default). */
  nativeFps: number;
  bytes?: number;
  file?: File;
  frameAt(time: number, longSide: number, crop?: CropRect | null): Promise<RgbaImage>;
  dispose(): void;
}

export class FileVideo implements VideoSource {
  name: string;
  duration = 0;
  width = 0;
  height = 0;
  nativeFps = 30;
  bytes: number;
  file: File;
  private video: HTMLVideoElement;
  private url: string;
  private busy: Promise<unknown> = Promise.resolve();

  private constructor(file: File) {
    this.file = file;
    this.name = file.name;
    this.bytes = file.size;
    this.url = URL.createObjectURL(file);
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.crossOrigin = 'anonymous';
    this.video.src = this.url;
  }

  static async open(file: File): Promise<FileVideo> {
    const v = new FileVideo(file);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The video took too long to open.')), 20000);
      v.video.onloadeddata = () => {
        clearTimeout(t);
        resolve();
      };
      v.video.onerror = () => {
        clearTimeout(t);
        reject(new Error('This browser cannot decode that video. MP4 (H.264) and WebM play almost everywhere.'));
      };
    });
    if (!Number.isFinite(v.video.duration)) await resolveDuration(v.video);
    v.duration = Number.isFinite(v.video.duration) ? v.video.duration : 0;
    v.width = v.video.videoWidth;
    v.height = v.video.videoHeight;
    if (!v.duration || !v.width) {
      v.dispose();
      throw new Error('The video has no readable frames.');
    }
    v.nativeFps = await estimateFps(v.video).catch(() => 30);
    return v;
  }

  private seek(time: number): Promise<void> {
    const v = this.video;
    const target = Math.min(Math.max(0, time), Math.max(0, this.duration - 0.001));
    return new Promise((resolve) => {
      if (Math.abs(v.currentTime - target) < 1e-4 && v.readyState >= 2) {
        resolve();
        return;
      }
      const done = () => {
        v.removeEventListener('seeked', done);
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(done, 4000);
      v.addEventListener('seeked', done);
      v.currentTime = target;
    });
  }

  frameAt(time: number, longSide: number, crop?: CropRect | null): Promise<RgbaImage> {
    // Serialise seeks: one <video> element can only be at one place at a time.
    const job = this.busy.then(async () => {
      await this.seek(time);
      return rasterize(this.video, longSide, crop);
    });
    this.busy = job.catch(() => undefined);
    return job;
  }

  dispose(): void {
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}

/**
 * Recordings made with MediaRecorder (and some screen recorders) report
 * duration = Infinity until the end is reached. Seeking far past the end
 * makes the browser scan the file and fire durationchange.
 */
function resolveDuration(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('durationchange', onChange);
      clearTimeout(t);
      video.currentTime = 0;
      resolve();
    };
    const onChange = () => {
      if (Number.isFinite(video.duration)) done();
    };
    const t = setTimeout(done, 8000);
    video.addEventListener('durationchange', onChange);
    video.currentTime = 1e101;
  });
}

/** Estimate fps with requestVideoFrameCallback when available. */
async function estimateFps(video: HTMLVideoElement): Promise<number> {
  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => number;
  };
  if (!v.requestVideoFrameCallback) return 30;
  return new Promise((resolve) => {
    const samples: number[] = [];
    let last = -1;
    const stop = setTimeout(() => finish(), 1500);
    const finish = () => {
      clearTimeout(stop);
      video.pause();
      video.currentTime = 0;
      if (samples.length < 3) return resolve(30);
      samples.sort((a, b) => a - b);
      const dt = samples[Math.floor(samples.length / 2)];
      const fps = dt > 0 ? 1 / dt : 30;
      const common = [12, 15, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
      const snap = common.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a));
      resolve(Math.abs(snap - fps) < 2 ? snap : Math.round(fps));
    };
    const cb = (_now: number, meta: { mediaTime: number }) => {
      if (last >= 0 && meta.mediaTime > last) samples.push(meta.mediaTime - last);
      last = meta.mediaTime;
      if (samples.length >= 8) finish();
      else v.requestVideoFrameCallback!(cb);
    };
    v.requestVideoFrameCallback(cb);
    video.play().catch(() => finish());
  });
}

/** Frame times for a clip between start and end at fps. */
export function frameTimes(start: number, end: number, fps: number, maxFrames: number): number[] {
  const out: number[] = [];
  const step = 1 / fps;
  for (let t = start; t < end - 1e-6 && out.length < maxFrames; t += step) out.push(t);
  if (out.length === 0) out.push(start);
  return out;
}
