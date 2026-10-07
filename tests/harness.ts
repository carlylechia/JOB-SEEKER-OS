/**
 * Minimal test harness.
 *
 * Uses Node's BUILT-IN test runner (`node:test`) plus a small `expect`
 * implementation rather than pulling in a large test framework. This keeps the
 * dependency surface unchanged for a project that has no test framework today,
 * and means the suite runs anywhere Node 22+ is installed.
 *
 * Run with:  npm test
 */

import assert from 'node:assert/strict';
import {
  describe as nodeDescribe,
  it as nodeIt,
  before as nodeBefore,
  after as nodeAfter,
  beforeEach as nodeBeforeEach,
  afterEach as nodeAfterEach,
} from 'node:test';

export const describe = nodeDescribe;
export const it = nodeIt;
export const test = nodeIt;
export const before = nodeBefore;
export const after = nodeAfter;
export const beforeEach = nodeBeforeEach;
export const afterEach = nodeAfterEach;

function format(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function matchesObject(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== 'object' || actual === null) return false;
  return Object.entries(expected).every(([key, want]) => {
    const got = (actual as Record<string, unknown>)[key];
    if (want !== null && typeof want === 'object' && !(want instanceof RegExp)) {
      return matchesObject(got, want as Record<string, unknown>);
    }
    return Object.is(got, want);
  });
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

/**
 * Matcher implementations. Every one takes `(actual, expected)` — `expect()`
 * binds `actual` so callers write `expect(x).toBe(y)`.
 */
const POSITIVE: Record<string, (actual: unknown, expected?: unknown) => void> = {
  toBe(actual, expected) {
    assert.ok(
      Object.is(actual, expected),
      `expected ${format(actual)} to be ${format(expected)}`,
    );
  },
  toEqual(actual, expected) {
    assert.deepStrictEqual(actual, expected);
  },
  toStrictEqual(actual, expected) {
    assert.deepStrictEqual(actual, expected);
  },
  toBeNull(actual) {
    assert.strictEqual(actual, null);
  },
  toBeUndefined(actual) {
    assert.strictEqual(actual, undefined);
  },
  toBeDefined(actual) {
    assert.ok(actual !== undefined, 'expected value to be defined');
  },
  toBeTruthy(actual) {
    assert.ok(actual, `expected ${format(actual)} to be truthy`);
  },
  toBeFalsy(actual) {
    assert.ok(!actual, `expected ${format(actual)} to be falsy`);
  },
  toContain(actual, expected) {
    assert.ok(
      typeof actual === 'string' || Array.isArray(actual),
      `toContain expects a string or array, received ${format(actual)}`,
    );
    assert.ok(
      (actual as string | unknown[]).includes(expected as never),
      `expected ${format(actual)} to contain ${format(expected)}`,
    );
  },
  toHaveLength(actual, expected) {
    assert.strictEqual((actual as { length?: number })?.length, expected as number);
  },
  toHaveProperty(actual, key) {
    assert.ok(
      typeof actual === 'object' && actual !== null && (key as string) in (actual as object),
      `expected object to have property ${String(key)}`,
    );
  },
  toBeGreaterThan(actual, expected) {
    assert.ok(actual! > expected!, `expected ${String(actual)} > ${String(expected)}`);
  },
  toBeGreaterThanOrEqual(actual, expected) {
    assert.ok(actual! >= expected!, `expected ${String(actual)} >= ${String(expected)}`);
  },
  toBeLessThan(actual, expected) {
    assert.ok(actual! < expected!, `expected ${String(actual)} < ${String(expected)}`);
  },
  toBeLessThanOrEqual(actual, expected) {
    assert.ok(actual! <= expected!, `expected ${String(actual)} <= ${String(expected)}`);
  },
  toBeInstanceOf(actual, ctor) {
    assert.ok(
      actual instanceof (ctor as Function),
      `expected ${format(actual)} to be instance of ${(ctor as Function)?.name}`,
    );
  },
  toMatchObject(actual, expected) {
    assert.ok(
      matchesObject(actual, expected as Record<string, unknown>),
      `expected ${format(actual)} to match ${format(expected)}`,
    );
  },
  /**
   * In the sync form this is a misuse (there is nothing that threw); in the
   * `.rejects` form the subject IS the error, so any error satisfies it.
   */
  toThrow(actual?: unknown) {
    if (arguments.length > 0 && actual === undefined) {
      throw new Error(
        'toThrow() is only valid in the rejects form: expect(fn).rejects.toThrow()',
      );
    }
  },
};

const NEGATIVE: Record<string, (actual: unknown, expected?: unknown) => void> = {
  toBe(actual, expected) {
    assert.ok(
      !Object.is(actual, expected),
      `expected ${format(actual)} not to be ${format(expected)}`,
    );
  },
  toEqual(actual, expected) {
    assert.ok(!isDeepEqual(actual, expected), 'expected values not to be equal');
  },
  toStrictEqual(actual, expected) {
    assert.ok(!isDeepEqual(actual, expected), 'expected values not to be strictly equal');
  },
  toBeNull(actual) {
    assert.notStrictEqual(actual, null);
  },
  toBeUndefined(actual) {
    assert.notStrictEqual(actual, undefined);
  },
  toBeDefined(actual) {
    assert.strictEqual(actual, undefined, 'expected value to be undefined');
  },
  toBeTruthy(actual) {
    assert.ok(!actual, `expected ${format(actual)} to be falsy`);
  },
  toBeFalsy(actual) {
    assert.ok(actual, `expected ${format(actual)} to be truthy`);
  },
  toContain(actual, expected) {
    assert.ok(
      !(actual as string | unknown[]).includes(expected as never),
      `expected ${format(actual)} not to contain ${format(expected)}`,
    );
  },
  toHaveLength(actual, expected) {
    assert.notStrictEqual((actual as { length?: number })?.length, expected as number);
  },
  toHaveProperty(actual, key) {
    assert.ok(
      !(typeof actual === 'object' && actual !== null && (key as string) in (actual as object)),
      `expected object not to have property ${String(key)}`,
    );
  },
  toBeGreaterThan(actual, expected) {
    assert.ok(actual! <= expected!, `expected ${String(actual)} not > ${String(expected)}`);
  },
  toBeGreaterThanOrEqual(actual, expected) {
    assert.ok(actual! < expected!, `expected ${String(actual)} not >= ${String(expected)}`);
  },
  toBeLessThan(actual, expected) {
    assert.ok(actual! >= expected!, `expected ${String(actual)} not < ${String(expected)}`);
  },
  toBeLessThanOrEqual(actual, expected) {
    assert.ok(actual! > expected!, `expected ${String(actual)} not <= ${String(expected)}`);
  },
  toBeInstanceOf(actual, ctor) {
    assert.ok(
      !(actual instanceof (ctor as Function)),
      `expected value not to be instance of ${(ctor as Function)?.name}`,
    );
  },
  toMatchObject(actual, expected) {
    assert.ok(
      !matchesObject(actual, expected as Record<string, unknown>),
      'expected values not to match',
    );
  },
  toThrow() {
    throw new Error('toThrow() is only valid in the rejects form');
  },
};

type AsyncMatcherSet = Record<string, (expected?: unknown) => Promise<void>>;
type BoundMatchers = Record<string, (expected?: unknown) => void> & {
  not: BoundMatchers;
  resolves: AsyncMatcherSet & PromiseLike<AsyncMatcherSet>;
  rejects: AsyncMatcherSet & PromiseLike<AsyncMatcherSet>;
};

/** Bind the subject into a matcher set so callers pass only `expected`. */
function bind(actual: unknown, set: Record<string, (a: unknown, e?: unknown) => void>): BoundMatchers {
  const bound = {} as Record<string, (expected?: unknown) => void>;
  for (const [name, fn] of Object.entries(set)) {
    bound[name] = (expected?: unknown) => {
      fn(actual, expected);
    };
  }
  return bound as BoundMatchers;
}

/**
 * The object returned by `.resolves` / `.rejects`.
 *
 * Every matcher returns a promise, so both styles work:
 *   await expect(p).rejects.toThrow();
 *   expect(p).rejects.toBeInstanceOf(Error);
 *
 * No Proxy: the settled value (or rejection reason) is captured in a closure,
 * which keeps the rejected error intact for toBeInstanceOf / toThrow.
 */
type AsyncMatchers = AsyncMatcherSet & PromiseLike<AsyncMatcherSet>;

function asyncMatchers(
  settle: () => Promise<{ subject: unknown; failure?: string }>,
): AsyncMatchers {
  function build(): AsyncMatchers {
    const obj: Record<string, unknown> = {
      then(
        onFulfilled?: (m: AsyncMatchers) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) {
        return settle().then(
          () => (onFulfilled ? onFulfilled(build()) : undefined),
          (error) => (onRejected ? onRejected(error) : undefined),
        );
      },
      catch(onRejected?: (e: unknown) => unknown) {
        return settle().then(undefined, (error) =>
          onRejected ? onRejected(error) : undefined,
        );
      },
    };

    for (const [name, fn] of Object.entries(POSITIVE)) {
      obj[name] = async (expected?: unknown) => {
        const { subject, failure } = await settle();
        // `failure` is the message to raise when the promise settled the wrong
        // way; undefined means the assertion target was obtained.
        if (failure) throw new Error(failure);
        fn(subject, expected);
      };
    }

    return obj as AsyncMatchers;
  }

  return build();
}

/**
 * `expect(subject)` returns matchers bound to `subject`, plus `.not` and the
 * async `.resolves` / `.rejects` forms.
 */
export function expect(subject: unknown): BoundMatchers {
  const bound = bind(subject, POSITIVE);
  bound.not = bind(subject, NEGATIVE);

  let resolvesAsync: AsyncMatchers | undefined;
  let rejectsAsync: AsyncMatchers | undefined;

  // Lazy so a plain `expect(x).toBe(y)` never creates a stray promise (an
  // unhandled rejection would surface as an unrelated test failure).
  Object.defineProperty(bound, 'resolves', {
    get() {
      resolvesAsync ??= asyncMatchers(async () => {
        try {
          return { subject: await subject };
        } catch (error) {
          return {
            subject: undefined,
            failure: `expected promise to resolve, but it rejected with ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      });
      return resolvesAsync;
    },
    enumerable: false,
  });

  Object.defineProperty(bound, 'rejects', {
    get() {
      rejectsAsync ??= asyncMatchers(async () => {
        try {
          await subject;
        } catch (error) {
          // The rejection reason becomes the subject, so toBeInstanceOf /
          // toThrow inspect the real error.
          return { subject: error };
        }
        // Settled the wrong way: raise the failure inside the matcher.
        return {
          subject: undefined,
          failure: 'expected promise to reject, but it resolved',
        };
      });
      return rejectsAsync;
    },
    enumerable: false,
  });

  return bound;
}

export { assert };
