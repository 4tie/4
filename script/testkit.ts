type TestFn = () => void | Promise<void>;

type Suite = {
  name: string;
  tests: Array<{ name: string; fn: TestFn }>;
  suites: Suite[];
};

const root: Suite = { name: "root", tests: [], suites: [] };
let stack: Suite[] = [root];

export function describe(name: string, fn: () => void) {
  const parent = stack[stack.length - 1];
  const suite: Suite = { name, tests: [], suites: [] };
  parent.suites.push(suite);
  stack.push(suite);
  try {
    fn();
  } finally {
    stack.pop();
  }
}

export function it(name: string, fn: TestFn) {
  const suite = stack[stack.length - 1];
  suite.tests.push({ name, fn });
}

function deepEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (!deepEqual(ak, bk)) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

class ExpectationError extends Error {
  override name = "ExpectationError";
}

function fail(message: string): never {
  throw new ExpectationError(message);
}

type StringContaining = { __kind: "stringContaining"; needle: string };
export function stringContaining(needle: string): StringContaining {
  return { __kind: "stringContaining", needle };
}

function matchContains(haystack: any, expected: any): boolean {
  if (expected && typeof expected === "object" && (expected as any).__kind === "stringContaining") {
    const needle = String((expected as any).needle ?? "");
    return String(haystack ?? "").includes(needle);
  }
  return deepEqual(haystack, expected);
}

export function expect(received: any) {
  return {
    toBe(expected: any) {
      if (!Object.is(received, expected)) fail(`Expected ${String(received)} to be ${String(expected)}`);
    },
    toEqual(expected: any) {
      if (!deepEqual(received, expected)) fail(`Expected values to be deeply equal`);
    },
    toBeNull() {
      if (received !== null) fail(`Expected ${String(received)} to be null`);
    },
    toBeUndefined() {
      if (received !== undefined) fail(`Expected ${String(received)} to be undefined`);
    },
    toContain(expected: any) {
      if (!Array.isArray(received)) fail(`Expected value to be an array`);
      const ok = received.some((x) => matchContains(x, expected));
      if (!ok) fail(`Expected array to contain expected value`);
    },
    toThrow() {
      if (typeof received !== "function") fail(`toThrow expects a function`);
      let threw = false;
      try {
        received();
      } catch {
        threw = true;
      }
      if (!threw) fail(`Expected function to throw`);
    },
    not: {
      toThrow() {
        if (typeof received !== "function") fail(`not.toThrow expects a function`);
        try {
          received();
        } catch (e: any) {
          fail(`Expected function not to throw, but threw: ${e?.message || String(e)}`);
        }
      },
    },
  };
}

export async function run() {
  const failures: Array<{ name: string; error: any }> = [];
  let passed = 0;
  let total = 0;

  const walk = async (suite: Suite, prefix: string) => {
    const label = suite.name === "root" ? prefix : (prefix ? `${prefix} > ${suite.name}` : suite.name);
    for (const t of suite.tests) {
      total++;
      const name = label ? `${label} > ${t.name}` : t.name;
      try {
        await t.fn();
        passed++;
      } catch (e) {
        failures.push({ name, error: e });
      }
    }
    for (const s of suite.suites) await walk(s, label);
  };

  await walk(root, "");

  if (failures.length) {
    for (const f of failures) {
      console.error(`\nFAIL: ${f.name}`);
      console.error(f.error);
    }
    throw new Error(`Tests failed: ${failures.length}/${total}`);
  }

  console.log(`Tests passed: ${passed}/${total}`);
}

