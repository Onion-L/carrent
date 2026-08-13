declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export const mock: {
    module(id: string, factory: () => unknown): void;
  };

  export interface Matchers<T> {
    toBe(expected: unknown): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toContain(expected: unknown): void;
    toMatch(expected: RegExp | string): void;
    toContainEqual(expected: unknown): void;
    toMatchObject(expected: unknown): void;
    toThrow(expected?: unknown): void;
    toBeString(): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    not: Matchers<T>;
  }

  export function expect<T>(actual: T): Matchers<T>;
}
