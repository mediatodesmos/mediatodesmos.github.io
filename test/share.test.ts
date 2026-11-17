import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare } from '../src/store/share';
import { emptyState, imageViewport } from '../src/desmos/state';
import { consoleSnippet, latexLines, latexParts, parseStateFile, slug, bookmarkletHref } from '../src/desmos/export';

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
    expect(latexLines(state(), { fit: false }).split('\n')).toEqual(['X_{a1}=\\left[1,2,3\\right]', '\\left(X_{a1},1\\right)']);
  });

  it('fits a pasted drawing into the default Desmos view', () => {
    const lines = latexLines(state()).split('\n');
    // viewport 108 x 54 (4% margin each side): scale min(18/108, 10/54) = 0.167, centred on (50, 25)
    expect(lines[0]).toBe('Q\\left(x,y\\right)=\\left(0.167\\left(x-50\\right),0.167\\left(y-25\\right)\\right)');
    expect(lines[2]).toBe('Q\\left(X_{a1},1\\right)');
  });

  it('wraps shared point functions and polygons, and remaps video frames', () => {
    const s = emptyState(imageViewport(100, 50));
    s.expressions.list = [
      { type: 'expression', id: 'F', latex: 'F=1' },
      { type: 'folder', id: 'm2d-data', title: 'data', collapsed: true },
      { type: 'expression', id: 'p1', folderId: 'm2d-data', latex: 'P_{1}\\left(t,k\\right)=\\left(1,2\\right)' },
      { type: 'expression', id: 'd1', latex: 'P_{1}\\left(t,U_{1}\\left[F\\right]\\right)' },
      { type: 'expression', id: 'd2', latex: '\\operatorname{polygon}\\left(\\left(X\\left[F\\right],Y\\right)\\right)' },
    ];
    s.expressions.ticker = { handlerLatex: 'F\\to\\operatorname{mod}\\left(F,40\\right)+1', minStepLatex: '83', open: true, playing: false };
    const lines = latexLines(s).split('\n');
    expect(lines[1]).toContain('F_{r}=\\max\\left(1,\\min\\left(40,');
    expect(lines).toContain('P_{1}\\left(t,k\\right)=Q\\left(1,2\\right)');
    expect(lines).toContain('F=-10');
    expect(lines).toContain('P_{1}\\left(t,U_{1}\\left[F_{r}\\right]\\right)');
    expect(lines).toContain('\\operatorname{polygon}\\left(Q\\left(X\\left[F_{r}\\right],Y\\right)\\right)');
  });

  it('splits a big paste into parts without breaking lines', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L_{${i}}=` + 'x'.repeat(100));
    const parts = latexParts(lines.join('\n'), 1000);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join('\n')).toBe(lines.join('\n'));
    expect(latexParts('a\nb', 1000)).toEqual(['a\nb']);
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
