import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, parse, evaluate, run, expand, compressionRatio, SYMBOLS } from './konomi.mjs';

// ── the OG KonomiLang example (from Thomas Frumkin's docs) runs correctly ──
test('runs the documented KonomiLang example: variables, ask, and if/else branching', () => {
  const prog = 'let greeting = "Hello, AI!"\nask greeting\nlet age = 25\nif (age >= 18) { ask "career?" } else { ask "study?" }';
  const r = run(prog);
  assert.equal(r.ok, true);
  assert.equal(r.vars.greeting, 'Hello, AI!');
  assert.equal(r.vars.age, 25);
  assert.deepEqual(r.asks, ['Hello, AI!', 'career?']);   // age 25 >= 18 → the THEN branch
});
test('the else branch is taken when the condition is false', () => {
  const r = run('let age = 10\nif (age >= 18) { ask "career?" } else { ask "study?" }');
  assert.deepEqual(r.asks, ['study?']);
});

// ── tokenizer ──
test('tokenize: strings, numbers, identifiers, keywords, comments, two/one-char operators', () => {
  const t = tokenize('let x = 3.5 >= 2 // hi\nask "q"');
  assert.equal(t.ok, true);
  const kinds = t.toks.map((k) => k.t);
  assert.ok(kinds.includes('let') && kinds.includes('ident') && kinds.includes('num') && kinds.includes('str'));
  assert.ok(t.toks.some((k) => k.t === 'op' && k.v === '>='));   // two-char op captured whole (kills the 2-char branch)
  assert.equal(t.toks[t.toks.length - 1].t, 'eof');
});
test('tokenize errors: unterminated string, bad char, non-string', () => {
  assert.equal(tokenize('ask "no end').ok, false);
  assert.equal(tokenize('let x = @').ok, false);
  assert.equal(tokenize(42).ok, false);
});
test('tokenize is total on hostile input (never throws)', () => {
  for (const junk of ['', '"', '///', '((((', '\u0000', '99.9.9.9']) assert.equal(typeof tokenize(junk).ok, 'boolean');
});

// ── parser precedence ──
test('parse+eval: multiplicative binds tighter than additive', () => {
  assert.equal(run('let x = 2 + 3 * 4\nask x').asks[0], '14');   // not 20
  assert.equal(run('let x = (2 + 3) * 4\nask x').asks[0], '20'); // parens override
});
test('parse errors are returned, not thrown', () => {
  assert.equal(parse(tokenize('let = 5').toks).ok, false);       // missing name
  assert.equal(parse(tokenize('if (1) { ask 1').toks).ok, false); // unterminated block
  assert.equal(parse('not-an-array').ok, false);
});
test('eat enforces the exact op VALUE, not just the op type', () => {
  // a wrong-valued op where "=" is expected must fail (kills the value-guard mutants in eat)
  assert.equal(run('let x + 5').ok, false);
  assert.equal(run('let x = (2 + 3').ok, false);   // missing ")"
});
test('all whitespace kinds are skipped: spaces, tabs and CR', () => {
  assert.equal(run('let a =\t5\nask a').asks[0], '5');       // tab is whitespace (kills the || → && on \t)
  assert.equal(run('let a = 5\r\nask a').asks[0], '5');       // CRLF: the \r is whitespace (kills the || → && on \r)
  assert.equal(run('let\ta\t=\t5\r\nask\ta').asks[0], '5');   // tabs + CR together, still one clean run
});
test('parser diagnostics name the offending token (error text is part of the contract)', () => {
  const e = run('let 5 = 3');                 // a number where an identifier name is required
  assert.equal(e.ok, false);                  // kills eat outer || → && (would wrongly accept it)
  assert.ok(e.error.includes('ident'));       // expected-label is "ident" (kills the (v || t) → && message mutant)
  assert.ok(e.error.includes('5'));           // got-token is the literal 5 (kills the (tk.v || tk.t) → && message mutant)
  assert.ok(run('ask )').error.includes(')')); // primary names ")" (kills L67 (tk.v || tk.t) → && message mutant)
  assert.ok(run('5 + 3').error.includes('5')); // statement names "5" (kills L85 (tk.v || tk.t) → && message mutant)
  assert.equal(run('ask + 1 )').ok, false);    // a leading binary op is not a primary (kills primary's && → ||)
});
test('// comments are skipped: trailing on a line and a whole line', () => {
  assert.equal(run('let x = 5 // note here\nask x').asks[0], '5');   // trailing comment (kills c === "/" → !==)
  assert.equal(run('// whole line comment\nlet y = 7\nask y').asks[0], '7');
  assert.equal(run('ask 3 // no trailing newline').asks[0], '3');     // comment runs to EOF
  assert.equal(run('let d = 6 / 2\nask d').asks[0], '3');             // a lone "/" is division, not a comment
});

// ── character-class boundaries (kill the >=/<= range mutants in isDigit / isIdentStart) ──
test('digit boundaries: 0 and 9 are recognised as number characters', () => {
  assert.equal(run('let n = 0\nask n').asks[0], '0');   // kills c >= "0" → c > "0"
  assert.equal(run('let n = 9\nask n').asks[0], '9');   // kills c <= "9" → c < "9"
  assert.equal(run('let n = 90\nask n').asks[0], '90');
});
test('identifier-start boundaries: a, z, A, Z and _ are all valid first characters', () => {
  assert.equal(run('let a = 1\nask a').asks[0], '1');   // kills c >= "a" → c > "a" (and || → &&)
  assert.equal(run('let z = 1\nask z').asks[0], '1');   // kills c <= "z" → c < "z"
  assert.equal(run('let A = 1\nask A').asks[0], '1');   // kills c >= "A" → c > "A"
  assert.equal(run('let Z = 1\nask Z').asks[0], '1');   // kills c <= "Z" → c < "Z"
  assert.equal(run('let _ = 1\nask _').asks[0], '1');   // kills the c === "_" clause
});

// ── evaluator: every operator, truthiness, edges ──
test('every arithmetic and comparison operator computes correctly', () => {
  assert.equal(run('let a = 7 - 2\nask a').asks[0], '5');
  assert.equal(run('let a = 6 / 3\nask a').asks[0], '2');
  assert.equal(run('let a = 5 > 3\nask a').asks[0], '1');
  assert.equal(run('let a = 5 < 3\nask a').asks[0], '0');
  assert.equal(run('let a = 3 < 5\nask a').asks[0], '1');   // < true case (kills op === "<" → !==)
  assert.equal(run('let a = 5 > 5\nask a').asks[0], '0');   // > equal case (kills > → >=)
  assert.equal(run('let a = 5 < 5\nask a').asks[0], '0');   // < equal case (kills < → <=)
  assert.equal(run('let a = 3 <= 3\nask a').asks[0], '1');   // <= equal case (kills <= → <)
  assert.equal(run('let a = 3 >= 3\nask a').asks[0], '1');   // >= equal case (kills >= → >)
  assert.equal(run('let a = 3 == 3\nask a').asks[0], '1');
  assert.equal(run('let a = 3 != 3\nask a').asks[0], '0');
  assert.equal(run('let a = 3 != 4\nask a').asks[0], '1');   // != unequal case (kills op === "!=" → !== and !== → ===)
});
test('divide by zero returns 0, never throws (sovereign totality)', () => {
  assert.equal(run('let a = 5 / 0\nask a').asks[0], '0');
});
test('string concatenation with +, and an unknown variable reads as 0', () => {
  assert.equal(run('let a = "x" + 1\nask a').asks[0], 'x1');
  assert.equal(run('ask missing').asks[0], '0');            // undeclared var → 0
});
test('truthiness: nonzero number, non-empty string are true; 0 and "" are false', () => {
  assert.deepEqual(run('if (1) { ask "y" } else { ask "n" }').asks, ['y']);
  assert.deepEqual(run('if (0) { ask "y" } else { ask "n" }').asks, ['n']);
  assert.deepEqual(run('let s = "hi"\nif (s) { ask "y" } else { ask "n" }').asks, ['y']);
  assert.deepEqual(run('let s = "" \nif (s) { ask "y" } else { ask "n" }').asks, ['n']);
});
test('an if with no else and a false condition runs nothing', () => {
  assert.deepEqual(run('if (2 < 1) { ask "x" }').asks, []);
});
test('evaluate is total on a non-array ast', () => {
  assert.equal(evaluate('nope').ok, false);
});

// ── symbolic compression (measured, honest) ──
test('expand replaces each symbol with its keyword (and a separating space)', () => {
  assert.equal(expand('§g = 1'), 'let g = 1');
  assert.equal(expand('≫g'), 'ask g');
  assert.equal(expand('¿(1){≫"y"}¬{≫"n"}'), 'if (1){ask "y"}else {ask "n"}');
  assert.equal(expand(42), '');   // total on non-string
});
test('a compact symbolic program expands to valid KonomiLang and runs', () => {
  const compact = '§g = "hi"\n≫g\n¿(1 == 1){≫"yes"}¬{≫"no"}';
  const r = run(expand(compact));
  assert.equal(r.ok, true);
  assert.deepEqual(r.asks, ['hi', 'yes']);
});
test('compressionRatio MEASURES expanded/compact and is honest about its size', () => {
  const c = compressionRatio('§x = 1\n≫x');
  assert.equal(c.ok, true);
  assert.equal(c.expandedChars, expand('§x = 1\n≫x').length);
  assert.equal(c.compactChars, '§x = 1\n≫x'.length);
  assert.equal(c.ratio, c.expandedChars / c.compactChars);
  assert.ok(c.ratio > 1);                       // it IS compression
  assert.equal(compressionRatio('').ok, false); // empty refused
  assert.equal(compressionRatio(5).ok, false);  // non-string refused
});
test('SYMBOLS is the four-keyword map', () => {
  assert.deepEqual(Object.keys(SYMBOLS).sort(), ['¬', '¿', '§', '≫'].sort());
});
