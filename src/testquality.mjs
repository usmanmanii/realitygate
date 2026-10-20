// Tests that can't fail. RealityGate's Tests category used to count test
// files, so `test("x", () => {})` or `expect(true).toBe(true)` looked as
// healthy as a real test. These checks read test files only: R-019 for tests
// that cannot fail (and committed `.only`, which silently drops the rest of
// the suite), R-020 for committed unconditional skips.
//
// Every pattern is anchored at the start of a line, so a test written inside a
// one-line string (a fixture in another test) is not mistaken for a real one.

import { isTestFile } from "./files.mjs";

const JS = /\.[cm]?[jt]sx?$/;
const PY = /\.py$/;
const GO = /\.go$/;
// Folders that hold test data and doubles, not tests.
const NOT_TESTS = /(?:^|\/)(?:__mocks__|__fixtures__|fixtures?|__snapshots__|testdata)\//;

/** A file that holds tests (as opposed to fixtures, mocks or snapshots). */
export function isRealTestFile(path) {
  return /\.(?:[cm]?[jt]sx?|py|go)$/.test(path) && isTestFile(path) && !NOT_TESTS.test(path);
}

const JS_STR = String.raw`(?:"[^"\n]*"|'[^'\n]*'|` + "`[^`\\n]*`" + ")";
const JS_LIT = String.raw`(?:true|false|null|undefined|-?\d+(?:\.\d+)?|"[^"\n]*"|'[^'\n]*')`;
const JS_EMPTY_BODY = String.raw`\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}`;
const JS_FN = String.raw`(?:async\s+)?(?:\(\s*[\w$,{}\s]*\)|[\w$]+)\s*=>\s*` + JS_EMPTY_BODY + String.raw`|(?:async\s+)?function\s*[\w$]*\s*\([^)]*\)\s*` + JS_EMPTY_BODY;
const JS_TEST_CALL = /^[ \t]*(?:it|test)(?:\.(?:only|concurrent|serial))?\s*\(/gm;

const JS_RULES = [
  { re: new RegExp(String.raw`^[ \t]*(?:it|test)(?:\.(?:only|concurrent|serial))?\s*\(\s*${JS_STR}\s*,\s*(?:${JS_FN})\s*\)`, "gm"), why: "empty test body" },
  { re: new RegExp(String.raw`^[ \t]*(?:await\s+)?expect\(\s*(${JS_LIT})\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual|to\.equal|to\.eql|to\.deep\.equal)\s*\(\s*\1\s*\)`, "gm"), why: "asserts a literal equals itself" },
  { re: /^[ \t]*(?:await\s+)?expect\(\s*(?:true|-?[1-9]\d*|"[^"\n]+"|'[^'\n]+')\s*\)\s*\.\s*(?:toBeTruthy|toBeDefined|to\.be\.true|to\.be\.ok|to\.exist)\b/gm, why: "asserts a literal is truthy" },
  { re: /^[ \t]*(?:await\s+)?expect\(\s*(?:false|null|0)\s*\)\s*\.\s*(?:toBeFalsy|to\.be\.false|to\.not\.be\.ok)\b/gm, why: "asserts a literal is falsy" },
  { re: /^[ \t]*(?:assert(?:\.ok|\.isTrue)?|t\.(?:ok|true|truthy|assert))\s*\(\s*true\s*[,)]/gm, why: "asserts true" },
  { re: new RegExp(String.raw`^[ \t]*(?:assert|t)\.(?:equal|strictEqual|deepEqual|deepStrictEqual|is|same)\s*\(\s*(${JS_LIT})\s*,\s*\1\s*[,)]`, "gm"), why: "asserts a literal equals itself" },
  { re: /^[ \t]*(?:it|test|describe|context|suite)\.only\s*\(|^[ \t]*f(?:it|describe)\s*\(|^[ \t]*(?:it|test|describe|suite)\s*\([^\n]*\{\s*only\s*:\s*true\b/gm, why: "committed .only: the rest of the suite does not run" },
];
const JS_SKIPS = /^[ \t]*(?:it|test|describe|context|suite)\.skip\s*\(|^[ \t]*x(?:it|test|describe|context)\s*\(|^[ \t]*(?:it|test|describe|suite)\s*\([^\n]*\{\s*skip\s*:\s*true\b/gm;
const JS_ASSERTS = /\bexpect\w*\s*[.(]|\bassert\w*\s*[.(]|\.should\b|\bshould\s*[.(]|\bt\.(?:is|not|true|false|truthy|falsy|deepEqual|equal|ok|notOk|throws|rejects|doesNotThrow|assert|same|match|snapshot|plan|pass|fail|strictEqual|deepStrictEqual|regex)\w*\s*\(|\b(?:get|find)(?:All)?By[A-Z]\w*\s*\(|\bcy\.\w+|\bsinon\.assert\b|\.expect\s*\(|\bstrictEqual\s*\(|\bdeepStrictEqual\s*\(/;

const PY_LIT = String.raw`(?:True|False|None|-?\d+(?:\.\d+)?|"[^"\n]*"|'[^'\n]*')`;
const PY_RULES = [
  { re: /^[ \t]*assert\s+(?:True|[1-9]\d*|"[^"\n]+"|'[^'\n]+')\s*(?:,[^\n]*)?(?:#[^\n]*)?$/gm, why: "asserts a literal is true" },
  { re: new RegExp(String.raw`^[ \t]*assert\s+(${PY_LIT})\s*==\s*\1\s*(?:,[^\n]*)?(?:#[^\n]*)?$`, "gm"), why: "asserts a literal equals itself" },
  { re: /^[ \t]*self\.assertTrue\(\s*True\s*[,)]/gm, why: "asserts True" },
  { re: new RegExp(String.raw`^[ \t]*self\.assert(?:Equal|Equals)\(\s*(${PY_LIT})\s*,\s*\1\s*[,)]`, "gm"), why: "asserts a literal equals itself" },
];
const PY_SKIPS = /^[ \t]*@(?:pytest\.mark\.skip|unittest\.skip)\b(?![A-Za-z])/gm;
const PY_TEST_DEF = /^([ \t]*)(?:async\s+)?def\s+(test\w*)\s*\(/gm;
const PY_ASSERTS = /^[ \t]*assert\b|\bself\.assert\w+\s*\(|\bself\.fail\s*\(|\bpytest\.(?:raises|warns|approx|fail)\b|\.assert_\w+\s*\(|\bassert_\w+\s*\(/m;

const GO_RULES = [
  { re: /^func\s+(Test\w*)\s*\(\s*\w+\s+\*testing\.T\s*\)\s*\{\s*\}/gm, why: "empty test body" },
];
const GO_SKIPS = /^func\s+Test\w*\s*\(\s*(\w+)\s+\*testing\.T\s*\)\s*\{\s*\1\.Skip(?:f|Now)?\(/gm;
const GO_TEST_FUNC = /^func\s+Test\w*\s*\(\s*\w+\s+\*testing\.T\s*\)/gm;
// `t.Error(` reports a failure; `err.Error()` only formats one, so the receiver must be the testing handle.
const GO_ASSERTS = /\b(?:t|tt|tb|b|f)\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(|\b(?:assert|require)\.\w+\s*\(|\bExpect\s*\(|\bcmp\.Diff\b|\bt\.Run\s*\(/;

const lineAt = (content, index) => content.slice(0, index).split("\n").length;
const lineText = (content, line) => content.split("\n")[line - 1] ?? "";

/** True when the file contains at least one assertion its framework would recognise. */
export function hasAssertion(file, content) {
  if (PY.test(file)) return PY_ASSERTS.test(content);
  if (GO.test(file)) return GO_ASSERTS.test(content);
  return JS_ASSERTS.test(content);
}

function testCount(file, content) {
  if (PY.test(file)) return [...content.matchAll(PY_TEST_DEF)].length;
  if (GO.test(file)) return [...content.matchAll(GO_TEST_FUNC)].length;
  return [...content.matchAll(JS_TEST_CALL)].length;
}

function firstTestIndex(file, content) {
  const re = PY.test(file) ? PY_TEST_DEF : GO.test(file) ? GO_TEST_FUNC : JS_TEST_CALL;
  re.lastIndex = 0;
  const m = re.exec(content);
  return m ? m.index : 0;
}

/** Python test functions whose body is only `pass`, `...` or a docstring. */
function emptyPythonTests(content) {
  const lines = content.split("\n");
  const out = [];
  for (const m of content.matchAll(PY_TEST_DEF)) {
    const start = lineAt(content, m.index);
    const indent = m[1].length;
    // Skip the rest of a multi-line signature, up to the line ending in ':'.
    let i = start - 1;
    while (i < lines.length && !/:\s*(?:#.*)?$/.test(lines[i])) i++;
    const body = [];
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      if (l.length - l.trimStart().length <= indent) break;
      body.push(l.trim());
    }
    const code = body.join("\n").replace(/^[rbuf]*("""|''')[\s\S]*?\1/i, "").replace(/^[rbuf]*("|')[^\n]*?\1$/im, "").trim();
    if (body.length > 0 && /^(?:pass|\.\.\.)?$/.test(code.replace(/\s+/g, ""))) out.push({ line: start, text: `def ${m[2]}: empty test body` });
  }
  return out;
}

function collect(content, rules) {
  const out = [];
  for (const { re, why } of rules) {
    re.lastIndex = 0;
    for (const m of content.matchAll(re)) {
      out.push({ line: lineAt(content, m.index + (m[0].length - m[0].trimStart().length)), text: `${why}: ${m[0].trim().replace(/\s+/g, " ").slice(0, 100)}` });
    }
  }
  return out;
}

/** R-019: tests that cannot fail, and committed `.only`. */
export function fakeTests(file, content) {
  if (!isRealTestFile(file)) return [];
  const out = PY.test(file)
    ? [...collect(content, PY_RULES), ...emptyPythonTests(content)]
    : GO.test(file)
      ? collect(content, GO_RULES)
      : JS.test(file)
        ? collect(content, JS_RULES)
        : [];
  const n = testCount(file, content);
  if (n > 0 && !hasAssertion(file, content)) {
    const line = lineAt(content, firstTestIndex(file, content));
    if (!/justified:/.test(lineText(content, line))) out.push({ line, text: `${n} test${n === 1 ? "" : "s"} and no assertion anywhere in the file` });
  }
  return dedupe(out);
}

/** R-020: tests skipped unconditionally and committed. Conditional skips (skipIf, skipif) are fine. */
export function skippedTests(file, content) {
  if (!isRealTestFile(file)) return [];
  const re = PY.test(file) ? PY_SKIPS : GO.test(file) ? GO_SKIPS : JS.test(file) ? JS_SKIPS : null;
  if (!re) return [];
  return collect(content, [{ re, why: "skipped" }]).filter((h) => !/justified:/.test(lineText(content, h.line)));
}

function dedupe(hits) {
  const seen = new Set();
  return hits
    .sort((a, b) => a.line - b.line)
    .filter((h) => {
      if (seen.has(h.line)) return false;
      seen.add(h.line);
      return true;
    });
}
