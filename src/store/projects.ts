/** Saved projects (IndexedDB). */

import type { TraceSettings } from '../pipeline/types';
import type { DesmosState } from '../desmos/state';
import { del, get, getAll, put } from './db';

export interface ProjectStats {
  shapes: number;
  units: number;
  unitLabel: string;
  bytes: number;
  expressions: number;
  frames?: number;
  fps?: number;
}

export interface Project {
  id: string;
  name: string;
  kind: 'image' | 'video';
  createdAt: number;
  updatedAt: number;
  settings: TraceSettings;
  video?: { fps: number; start: number; end: number };
  stats: ProjectStats;
  /** Small preview (SVG markup). */
  thumb: string;
  state: DesmosState;
  /** The original file, kept for re-editing when it is not too large. */
  source?: Blob;
  sourceName?: string;
}

export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export function newProjectId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function saveProject(p: Project): Promise<void> {
  await put('projects', p);
}

export async function listProjects(): Promise<Project[]> {
  const all = await getAll<Project>('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  return get<Project>('projects', id);
}

export async function deleteProject(id: string): Promise<void> {
  await del('projects', id);
}

// ------------------------------------------------------------- handoff to desmos.com

export interface Handoff {
  name: string;
  state: DesmosState;
  at: number;
}

/** Stage a graph for the "Send to Desmos" bookmarklet. */
export async function stageHandoff(name: string, state: DesmosState): Promise<void> {
  await put('kv', { name, state, at: Date.now() } satisfies Handoff, 'handoff');
}

export async function readHandoff(): Promise<Handoff | undefined> {
  return get<Handoff>('kv', 'handoff');
}
