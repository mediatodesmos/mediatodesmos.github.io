import type { TraceResult, TraceSettings } from './types';

export interface TraceRequest {
  id: number;
  width: number;
  height: number;
  /** RGBA bytes (transferred). */
  pixels: ArrayBuffer;
  settings: TraceSettings;
  preview?: boolean;
  histogram?: boolean;
}

export type TraceResponse =
  | { id: number; ok: true; result: TraceResult }
  | { id: number; ok: false; error: string };
