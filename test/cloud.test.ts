import { describe, expect, it } from 'vitest';
import { firestoreSafe } from '../src/store/cloud';

describe('firestoreSafe', () => {
  it('removes undefined values at every depth', () => {
    const out = firestoreSafe({ a: 1, b: undefined, stats: { frames: undefined, fps: undefined, shapes: 3 }, list: [1, undefined, { x: undefined, y: 2 }] });
    expect(out).toEqual({ a: 1, stats: { shapes: 3 }, list: [1, { y: 2 }] });
    expect(JSON.stringify(out)).not.toContain('undefined');
  });
});
