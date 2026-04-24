declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;

  export interface Matchers<T> {
    toBe(expected: unknown): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeGreaterThan(expected: number): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toContain(expected: string): void;
    toMatchObject(expected: unknown): void;
    toBeString(): void;
    toBeLessThan(expected: number): void;
    not: Matchers<T>;
  }

  export function expect<T>(actual: T): Matchers<T>;
}
