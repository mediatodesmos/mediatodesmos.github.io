/**
 * Share links: a graph packed into the URL hash.
 *   JSON -> deflate-raw (CompressionStream) -> base64url
 * Nothing is uploaded; the link itself carries the graph.
 */

import type { DesmosState } from '../desmos/state';

export interface SharePayload {
  v: 1;
  name: string;
  kind: 'image' | 'video';
  state: DesmosState;
}

/** Links longer than this get unwieldy in chat apps and some browsers. */
export const SHARE_LINK_LIMIT = 120_000;

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const blob = new Blob([data as BlobPart]);
  const out = await new Response(blob.stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeShare(p: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(p));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeShare(s: string): Promise<SharePayload> {
  const bytes = await pipe(fromBase64Url(s), new DecompressionStream('deflate-raw'));
  const p = JSON.parse(new TextDecoder().decode(bytes)) as SharePayload;
  if (!p || p.v !== 1 || !p.state || !Array.isArray(p.state.expressions?.list)) throw new Error('This share link is damaged or from a newer version.');
  return p;
}

export async function shareUrl(p: SharePayload): Promise<{ url: string; length: number }> {
  const code = await encodeShare(p);
  const url = `${location.origin}${location.pathname}#/view?d=${code}`;
  return { url, length: url.length };
}
