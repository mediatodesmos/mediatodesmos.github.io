/// <reference lib="webworker" />
/** Web Worker entry: runs trace() off the main thread. */

import { trace } from './trace';
import type { TraceRequest, TraceResponse } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<TraceRequest>) => {
  const req = ev.data;
  try {
    const result = trace(
      { width: req.width, height: req.height, data: new Uint8ClampedArray(req.pixels) },
      req.settings,
      { preview: req.preview, histogram: req.histogram },
    );
    const transfer: Transferable[] = [];
    if (result.preview) transfer.push(result.preview.buffer as ArrayBuffer);
    const res: TraceResponse = { id: req.id, ok: true, result };
    ctx.postMessage(res, transfer);
  } catch (err) {
    const res: TraceResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    ctx.postMessage(res);
  }
};
