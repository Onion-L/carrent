declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void): void;

  export interface Matchers<T> {
    toBe(expected: unknown): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeGreaterThan(expected: number): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
  }

  export function expect<T>(actual: T): Matchers<T>;
}
