/**
 * A small pool of tracing workers. Jobs are queued and handed to idle
 * workers; results come back as promises. Falls back to the main thread
 * if Workers are unavailable.
 */

import type { TraceRequest, TraceResponse } from './protocol';
import type { RgbaImage, TraceResult, TraceSettings } from './types';
import { trace } from './trace';

interface Job {
  req: TraceRequest;
  resolve: (r: TraceResult) => void;
  reject: (e: Error) => void;
}

export interface RunOptions {
  preview?: boolean;
  histogram?: boolean;
}

export class TracePool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private active = new Map<number, Job>();
  private busy = new Map<Worker, number>();
  private nextId = 1;
  private useWorkers: boolean;

  constructor(size = defaultSize()) {
    this.useWorkers = typeof Worker !== 'undefined';
    if (!this.useWorkers) return;
    for (let i = 0; i < size; i++) this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<TraceResponse>) => this.onResult(w, ev.data);
    w.onerror = (ev) => {
      const id = this.busy.get(w);
      if (id !== undefined) {
        const job = this.active.get(id);
        this.active.delete(id);
        job?.reject(new Error(ev.message || 'Worker crashed'));
      }
      this.replace(w);
    };
    this.workers.push(w);
    this.idle.push(w);
    return w;
  }

  private replace(w: Worker): void {
    w.terminate();
    this.workers = this.workers.filter((x) => x !== w);
    this.idle = this.idle.filter((x) => x !== w);
    this.busy.delete(w);
    this.spawn();
    this.pump();
  }

  private onResult(w: Worker, res: TraceResponse): void {
    const job = this.active.get(res.id);
    this.active.delete(res.id);
    this.busy.delete(w);
    this.idle.push(w);
    if (job) {
      if (res.ok) job.resolve(res.result);
      else job.reject(new Error(res.error));
    }
    this.pump();
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.active.set(job.req.id, job);
      this.busy.set(w, job.req.id);
      w.postMessage(job.req, [job.req.pixels]);
    }
  }

  /** Trace an image. The pixel buffer is copied, so the caller keeps its ImageData. */
  run(img: RgbaImage, settings: TraceSettings, opts: RunOptions = {}): Promise<TraceResult> {
    if (!this.useWorkers) {
      return Promise.resolve().then(() => trace(img, settings, opts));
    }
    const pixels = img.data.slice().buffer as ArrayBuffer;
    const req: TraceRequest = {
      id: this.nextId++,
      width: img.width,
      height: img.height,
      pixels,
      settings: { ...settings },
      preview: opts.preview,
      histogram: opts.histogram,
    };
    return new Promise((resolve, reject) => {
      this.queue.push({ req, resolve, reject });
      this.pump();
    });
  }

  /** Drop queued (not yet started) jobs, rejecting them. */
  clearQueue(): void {
    const q = this.queue;
    this.queue = [];
    for (const job of q) job.reject(new CancelledError());
  }

  get size(): number {
    return this.workers.length;
  }

  destroy(): void {
    this.clearQueue();
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

function defaultSize(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(6, hc - 1));
}

let shared: TracePool | null = null;
export function getPool(): TracePool {
  if (!shared) shared = new TracePool();
  return shared;
}
