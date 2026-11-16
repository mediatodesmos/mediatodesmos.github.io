import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare } from '../src/store/share';
import { emptyState, imageViewport } from '../src/desmos/state';
import { consoleSnippet, latexLines, parseStateFile, slug, bookmarkletHref } from '../src/desmos/export';

const state = () => {
  const s = emptyState(imageViewport(100, 50));
  s.expressions.list = [
    { type: 'folder', id: 'f', title: 'data', collapsed: true },
    { type: 'expression', id: 'a', folderId: 'f', latex: 'X_{a1}=\\left[1,2,3\\right]' },
    { type: 'expression', id: 'b', latex: '\\left(X_{a1},1\\right)', color: '#000000' },
  ];
  return s;
};

describe('share links', () => {
  it('round-trips a graph through the URL code', async () => {
    const p = { v: 1 as const, name: 'test', kind: 'image' as const, state: state() };
    const code = await encodeShare(p);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await decodeShare(code);
    expect(back).toEqual(p);
  });

  it('rejects damaged links', async () => {
    await expect(decodeShare('not-a-real-code')).rejects.toBeTruthy();
  });
});

describe('export helpers', () => {
  it('puts data lists before the expressions that use them', () => {
    expect(latexLines(state()).split('\n')).toEqual(['X_{a1}=\\left[1,2,3\\right]', '\\left(X_{a1},1\\right)']);
  });

  it('wraps the state in a Calc.setState call', () => {
    const s = consoleSnippet(state());
    expect(s.startsWith('Calc.setState({')).toBe(true);
    expect(s.endsWith('{allowUndo: true})')).toBe(true);
  });

  it('validates imported state files', () => {
    expect(parseStateFile(JSON.stringify(state())).version).toBe(11);
    expect(() => parseStateFile('{"hello":1}')).toThrow();
  });

  it('makes safe file names', () => {
    expect(slug('My Cat Photo (1).PNG')).toBe('my-cat-photo-1');
    expect(slug('***')).toBe('graph');
  });

  it('builds a bookmarklet that only accepts messages from this site', () => {
    const href = bookmarkletHref('https://mediatodesmos.github.io');
    expect(href.startsWith('javascript:')).toBe(true);
    const code = decodeURIComponent(href.slice('javascript:'.length));
    expect(code).toContain('e.origin!==o');
    expect(code).toContain('Calc.setState');
    expect(code).toContain('"https://mediatodesmos.github.io"');
  });
});
