/**
 * Cloud projects (BETA): signed-in people can keep saved graphs in their
 * account (Firestore) and open them on any device.
 *
 *   users/{uid}/projects/{id}           metadata (name, stats, small thumbnail)
 *   users/{uid}/projects/{id}/chunks/n  the Desmos state, compressed and split
 *                                       into pieces under Firestore's 1 MiB limit
 *
 * Only the finished graph is stored. The original picture or video never
 * leaves the device. Rules in firebase/firestore.rules let each person read
 * and write only their own documents.
 */

import { getAuthState } from '../account/auth';
import { getFirebaseApp } from '../account/auth';
import { isBetaEnabled } from '../account/beta';
import type { DesmosState } from '../desmos/state';
import type { Project, ProjectStats } from './projects';
import { compressJson, decompressJson } from './share';

/** Characters per chunk document (Firestore allows ~1 MiB per document). */
const CHUNK = 900_000;
/** Largest compressed graph we keep in the cloud. */
export const CLOUD_LIMIT = 5_000_000;
/** Thumbnails larger than this are left out of the cloud copy. */
const THUMB_LIMIT = 120_000;

export interface CloudProject {
  id: string;
  name: string;
  kind: 'image' | 'video';
  createdAt: number;
  updatedAt: number;
  stats: ProjectStats;
  thumb: string;
  size: number;
}

export class CloudError extends Error {}

/**
 * Firestore refuses documents that contain `undefined` anywhere, so values are
 * stripped before writing (older local projects can still carry them).
 */
export function firestoreSafe<T>(value: T): T {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined).map((v) => firestoreSafe(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (v !== undefined) out[k] = firestoreSafe(v);
    return out as T;
  }
  return value;
}

type FirestoreModule = typeof import('firebase/firestore');
let storePromise: Promise<{ fs: FirestoreModule; store: import('firebase/firestore').Firestore }> | null = null;

async function db() {
  if (!isBetaEnabled()) throw new CloudError('Sign in to use cloud projects.');
  const app = await getFirebaseApp();
  const uid = getAuthState().user?.uid;
  if (!app || !uid || uid === 'preview') throw new CloudError('Cloud projects need sign-in to be set up first.');
  storePromise ??= import('firebase/firestore').then((fs) => {
    let store: import('firebase/firestore').Firestore;
    try {
      store = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
    } catch {
      store = fs.getFirestore(app); // already initialised elsewhere
    }
    return { fs, store };
  });
  const { fs, store } = await storePromise;
  return { fs, store, uid };
}

export async function saveCloudProject(p: Project): Promise<CloudProject> {
  const { fs, store, uid } = await db();
  const packed = await compressJson(p.state);
  if (packed.length > CLOUD_LIMIT) {
    throw new CloudError(`This graph is too big for cloud projects (${(packed.length / 1e6).toFixed(1)} MB compressed, the limit is 5 MB). Export it instead.`);
  }
  const meta: CloudProject = firestoreSafe({
    id: p.id,
    name: p.name,
    kind: p.kind,
    createdAt: p.createdAt,
    updatedAt: Date.now(),
    stats: p.stats,
    thumb: p.thumb.length <= THUMB_LIMIT ? p.thumb : '',
    size: packed.length,
  });
  const ref = fs.doc(store, 'users', uid, 'projects', p.id);
  const old = await fs.getDocs(fs.collection(ref, 'chunks'));
  const batch = fs.writeBatch(store);
  old.forEach((d) => batch.delete(d.ref));
  const count = Math.ceil(packed.length / CHUNK);
  for (let i = 0; i < count; i++) batch.set(fs.doc(ref, 'chunks', String(i)), { data: packed.slice(i * CHUNK, (i + 1) * CHUNK) });
  batch.set(ref, { ...meta, chunks: count });
  try {
    await batch.commit();
  } catch (err) {
    throw new CloudError(`Could not save to the cloud: ${err instanceof Error ? err.message : String(err)}`);
  }
  return meta;
}

export async function listCloudProjects(): Promise<CloudProject[]> {
  const { fs, store, uid } = await db();
  const snap = await fs.getDocs(fs.query(fs.collection(store, 'users', uid, 'projects'), fs.orderBy('updatedAt', 'desc')));
  return snap.docs.map((d) => d.data() as CloudProject);
}

export async function loadCloudState(id: string): Promise<DesmosState> {
  const { fs, store, uid } = await db();
  const ref = fs.doc(store, 'users', uid, 'projects', id);
  const meta = await fs.getDoc(ref);
  if (!meta.exists()) throw new CloudError('That cloud project no longer exists.');
  const count = (meta.data() as { chunks: number }).chunks;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const c = await fs.getDoc(fs.doc(ref, 'chunks', String(i)));
    parts.push((c.data() as { data: string }).data);
  }
  return decompressJson<DesmosState>(parts.join(''));
}

export async function deleteCloudProject(id: string): Promise<void> {
  const { fs, store, uid } = await db();
  const ref = fs.doc(store, 'users', uid, 'projects', id);
  const chunks = await fs.getDocs(fs.collection(ref, 'chunks'));
  const batch = fs.writeBatch(store);
  chunks.forEach((d) => batch.delete(d.ref));
  batch.delete(ref);
  await batch.commit();
}
