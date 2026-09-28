// konomi.mjs — a sovereign KonomiLang interpreter (witness-gated). KonomiLang is Thomas Frumkin's OG
// language for AI interactions (let / ask / if / arithmetic / comparison); this brings it to the estate
// bar: a pure, total, deterministic interpreter that runs in a browser tab, with a symbolic-compression
// layer measured honestly (not asserted). Base language: Thomas Frumkin's KonomiLang. Upgrade: the estate's.
//
// `ask` in a sovereign kernel does not call a model — it RECORDS the resolved prompt, so run(src) yields the
// exact ordered prompts a program would send + the final variable state, deterministically. A local model
// (WebLLM / BYOK) answers at the edge; the gated floor needs none. Garbage in -> { ok:false, error }, never a throw.

const isDigit = (c) => c >= '0' && c <= '9';
const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c) => isIdentStart(c) || isDigit(c);
const KEYWORDS = new Set(['let', 'ask', 'if', 'else']);

// ── tokenizer ──
export function tokenize(src) {
  if (typeof src !== 'string') return { ok: false, error: 'source must be a string' };
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '"') {
      let s = ''; i += 1;
      while (i < n && src[i] !== '"') { s += src[i]; i += 1; }
      if (i >= n) return { ok: false, error: 'unterminated string' };
      i += 1; toks.push({ t: 'str', v: s }); continue;
    }
    if (isDigit(c)) {
      let num = '';
      while (i < n && (isDigit(src[i]) || src[i] === '.')) { num += src[i]; i += 1; }
      const val = Number(num);
      if (!Number.isFinite(val)) return { ok: false, error: 'bad number: ' + num };
      toks.push({ t: 'num', v: val }); continue;
    }
    if (isIdentStart(c)) {
      let id = '';
      while (i < n && isIdentPart(src[i])) { id += src[i]; i += 1; }
      toks.push({ t: KEYWORDS.has(id) ? id : 'ident', v: id }); continue;
    }
    // two-char operators first, then one-char
    const two = src.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=') { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/()<>{}='.includes(c)) { toks.push({ t: 'op', v: c }); i += 1; continue; }
    return { ok: false, error: 'unexpected character: ' + c };
  }
  toks.push({ t: 'eof', v: '' });
  return { ok: true, toks };
}

// ── parser (recursive descent) → { ok, ast } where ast is a list of statements ──
export function parse(toks) {
  if (!Array.isArray(toks)) return { ok: false, error: 'tokens must be an array' };
  let p = 0;
  const peek = () => toks[p] || { t: 'eof', v: '' };
  const next = () => toks[p++] || { t: 'eof', v: '' };
  const eat = (t, v) => { const tk = peek(); if (tk.t !== t || (v !== undefined && tk.v !== v)) throw new Error('expected ' + (v || t) + ' but got ' + (tk.v || tk.t)); return next(); };

  function primary() {
    const tk = peek();
    if (tk.t === 'num') { next(); return { k: 'num', v: tk.v }; }
    if (tk.t === 'str') { next(); return { k: 'str', v: tk.v }; }
    if (tk.t === 'ident') { next(); return { k: 'var', v: tk.v }; }
    if (tk.t === 'op' && tk.v === '(') { next(); const e = expr(); eat('op', ')'); return e; }
    throw new Error('unexpected ' + (tk.v || tk.t));
  }
  // precedence order, loosest to tightest: comparison, then additive, then multiplicative
  function mul() { let left = primary(); while (peek().t === 'op' && (peek().v === '*' || peek().v === '/')) { const op = next().v; left = { k: 'bin', op, left, right: primary() }; } return left; }
  function add() { let left = mul(); while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const op = next().v; left = { k: 'bin', op, left, right: mul() }; } return left; }
  function cmp() { let left = add(); while (peek().t === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(peek().v)) { const op = next().v; left = { k: 'bin', op, left, right: add() }; } return left; }
  function expr() { return cmp(); }

  // a '}' only ever closes a block when it is the OP '}', never the string "}" — hence the t==='op' guard.
  const atBlockEnd = () => peek().t === 'op' && peek().v === '}';
  function block() { eat('op', '{'); const stmts = []; while (!atBlockEnd() && peek().t !== 'eof') stmts.push(statement()); eat('op', '}'); return stmts; }
  function statement() {
    const tk = peek();
    if (tk.t === 'let') { next(); const name = eat('ident').v; eat('op', '='); const value = expr(); return { k: 'let', name, value }; }
    if (tk.t === 'ask') { next(); return { k: 'ask', value: expr() }; }
    if (tk.t === 'if') {
      next(); eat('op', '('); const cond = expr(); eat('op', ')'); const then = block();
      let els = null; if (peek().t === 'else') { next(); els = block(); }
      return { k: 'if', cond, then, els };
    }
    throw new Error('unexpected statement: ' + (tk.v || tk.t));
  }

  try {
    const ast = [];
    while (peek().t !== 'eof') ast.push(statement());
    return { ok: true, ast };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

// ── evaluator (deterministic; ask records the resolved prompt) ──
// every evaluated value is a number or a string, so one branch each — no dead third arm to breed mutants.
function truthy(v) { return typeof v === 'number' ? v !== 0 : v.length > 0; }
function applyOp(op, a, b) {
  if (op === '+') return a + b;   // JS + already does numeric add when both are numbers, else string concat
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') return b === 0 ? 0 : a / b;   // sovereign: never throw on divide-by-zero
  if (op === '>') return a > b ? 1 : 0;
  if (op === '<') return a < b ? 1 : 0;
  if (op === '>=') return a >= b ? 1 : 0;
  if (op === '<=') return a <= b ? 1 : 0;
  if (op === '==') return a === b ? 1 : 0;
  if (op === '!=') return a !== b ? 1 : 0;
  return 0;
}
export function evaluate(ast) {
  if (!Array.isArray(ast)) return { ok: false, error: 'ast must be an array' };
  const vars = {};
  const asks = [];
  function ev(node) {
    if (node.k === 'num' || node.k === 'str') return node.v;
    if (node.k === 'var') return Object.prototype.hasOwnProperty.call(vars, node.v) ? vars[node.v] : 0;
    if (node.k === 'bin') return applyOp(node.op, ev(node.left), ev(node.right));
    return 0;
  }
  function run(stmts) {
    for (const s of stmts) {
      if (s.k === 'let') vars[s.name] = ev(s.value);
      else if (s.k === 'ask') asks.push(String(ev(s.value)));
      else if (s.k === 'if') run(truthy(ev(s.cond)) ? s.then : (s.els || []));
    }
  }
  try { run(ast); return { ok: true, vars, asks }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

// ── run: the whole pipeline ──
export function run(src) {
  const t = tokenize(src); if (!t.ok) return t;
  const p = parse(t.toks); if (!p.ok) return p;
  return evaluate(p.ast);
}

// ── symbolic compression (Thomas's kΨ∞ idea, made real + MEASURED, not asserted) ──
// A compact symbol map expands to KonomiLang keywords. The ratio is expanded-length / compact-length —
// the honest compression on a given program, reported as a number, never a fixed claim.
export const SYMBOLS = { '§': 'let ', '≫': 'ask ', '¿': 'if ', '¬': 'else ' };
export function expand(compact) {
  if (typeof compact !== 'string') return '';
  let out = compact;
  for (const [sym, word] of Object.entries(SYMBOLS)) out = out.split(sym).join(word);
  return out;
}
export function compressionRatio(compact) {
  if (typeof compact !== 'string' || compact.length === 0) return { ok: false, error: 'compact source must be a non-empty string' };
  const expanded = expand(compact);
  return { ok: true, compactChars: compact.length, expandedChars: expanded.length, ratio: expanded.length / compact.length };
}

export default { tokenize, parse, evaluate, run, SYMBOLS, expand, compressionRatio };
