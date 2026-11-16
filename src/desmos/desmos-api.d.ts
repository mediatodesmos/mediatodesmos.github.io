/** Minimal typings for the parts of the Desmos API v1.12 we use. */
declare namespace Desmos {
  interface MathBounds {
    left: number;
    right: number;
    bottom: number;
    top: number;
  }
  interface ExpressionAnalysis {
    isError?: boolean;
    errorMessage?: string;
    isGraphable?: boolean;
    evaluation?: { type: string; value: unknown };
  }
  interface Calculator {
    setState(state: unknown, opts?: { allowUndo?: boolean; remapColors?: boolean }): void;
    getState(): unknown;
    setBlank(opts?: { allowUndo?: boolean }): void;
    setExpression(expr: Record<string, unknown>): void;
    setExpressions(exprs: Record<string, unknown>[]): void;
    removeExpressions(exprs: { id: string }[]): void;
    setMathBounds(bounds: MathBounds): void;
    updateSettings(settings: Record<string, unknown>): void;
    asyncScreenshot(opts: Record<string, unknown>, cb: (dataUri: string) => void): void;
    observeEvent(name: string, cb: () => void): void;
    unobserveEvent(name: string): void;
    resize(): void;
    destroy(): void;
    expressionAnalysis: Record<string, ExpressionAnalysis>;
    graphpaperBounds: { mathCoordinates: MathBounds & { width: number; height: number } };
  }
  function GraphingCalculator(el: HTMLElement, opts?: Record<string, unknown>): Calculator;
}

interface Window {
  Desmos?: typeof Desmos;
}
