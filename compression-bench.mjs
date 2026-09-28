// compression-bench.mjs — measure the KonomiLang symbolic-compression claim on REAL programs.
// Proof-of-play: we do NOT rubber-stamp "15×". We measure char-ratio AND an LLM-token proxy on a
// spread of real KonomiLang programs, under three honest schemes, and report whether it generalises.
//
// Run: node compression-bench.mjs
import { expand, compressionRatio, run } from './konomi.mjs';

// ── a spread of REAL KonomiLang programs (varied shape + size), all of which actually run ──
const PROGRAMS = {
  'hello':        'let name = "Alex"\nask "Introduce yourself to " + name',
  'branch':       'let age = 25\nif (age >= 18) { ask "career options?" } else { ask "study options?" }',
  'arithmetic':   'let total = 2 + 3 * 4\nlet half = total / 2\nask "total is " + total\nask "half is " + half',
  'multi-ask':    'let topic = "quantum computing"\nask "Explain " + topic\nask "Give an example of " + topic\nask "Common misconceptions about " + topic,',
  'nested':       'let score = 72\nif (score >= 90) { ask "grade A" } else { if (score >= 70) { ask "grade B" } else { ask "grade C" } }',
  'long-literals':'let brief = "Write a 500 word blog post about sovereign AI, with a headline and three sections"\nask brief\nask "Now rewrite " + brief + " for a technical audience"',
};

// ── an LLM-token PROXY: byte-pair-ish word/punct split. Real tokenizers differ, but this tracks the
//    thing the claim is really about — how many pieces a model must read. A single symbol is 1 piece. ──
function tokenProxy(s) {
  const m = s.match(/[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\.[0-9]+)?|"[^"]*"|>=|<=|==|!=|[^\sA-Za-z0-9_]/g);
  return m ? m.length : 0;
}

// ── Scheme A: the SHIPPED layer — one symbol per keyword (let/ask/if/else). ──
function schemeA(src) {
  let c = src;
  for (const [word, sym] of [['let ', '§'], ['ask ', '≫'], ['if ', '¿'], ['else ', '¬']]) c = c.split(word).join(sym);
  return c;
}

// ── Scheme B: MAXIMAL single-char-per-token — every keyword AND operator AND the common structural
//    punctuation collapses to one char. Literals (the actual prompt text + numbers) are irreducible:
//    they ARE the information, so they cannot be compressed without a per-corpus dictionary. ──
const B_MAP = [['>=','≥'],['<=','≤'],['==','≣'],['!=','≠'],['let ','§'],['ask ','≫'],['if ','¿'],['else ','¬'],
  ['(','⟨'],[')','⟩'],['{','⟦'],['}','⟧'],[' + ','⊕'],[' - ','⊖'],[' * ','⊗'],[' / ','⊘'],[' = ','≔'],[' > ','▸'],[' < ','◂']];
function schemeB(src) { let c = src; for (const [w, s] of B_MAP) c = c.split(w).join(s); return c; }

// ── Scheme C: the DICTIONARY trick that a naive "15×" implies — map each WHOLE program to one glyph.
//    This DOES hit huge ratios, and is exactly why the claim must be checked: it does not generalise,
//    it is a lookup table the size of your corpus (a new program is a cache miss = ratio 1). ──
function schemeC(src) { return '✦'; }  // one glyph "stands for" the whole known program

function pct(x) { return x.toFixed(2) + '×'; }
const rows = [];
let sumCharA = 0, sumTokA = 0, sumCharB = 0, sumTokB = 0, n = 0;

for (const [name, src] of Object.entries(PROGRAMS)) {
  // sanity: every benchmark program is a real, running KonomiLang program
  const ok = run(src.replace(/,$/,'')).ok;
  const a = schemeA(src), b = schemeB(src);
  // round-trip guard for scheme A: expand(compact) must reproduce the original (lossless)
  const lossless = expand(a) === src;
  const charA = src.length / a.length, charB = src.length / b.length;
  const tokA = tokenProxy(src) / tokenProxy(a), tokB = tokenProxy(src) / tokenProxy(b);
  rows.push({ name, runs: ok, losslessA: lossless, chars: src.length,
    A_char: pct(charA), A_tok: pct(tokA), B_char: pct(charB), B_tok: pct(tokB) });
  sumCharA += charA; sumTokA += tokA; sumCharB += charB; sumTokB += tokB; n++;
}

console.log('KonomiLang symbolic-compression benchmark —', n, 'real programs\n');
for (const r of rows) console.log(
  `  ${r.name.padEnd(14)} runs=${r.runs} lossless=${r.losslessA}  A:${r.A_char}/${r.A_tok}(char/tok)  B:${r.B_char}/${r.B_tok}`);
console.log('\n  MEAN  Scheme A (shipped keyword map):  char', pct(sumCharA/n), ' token-proxy', pct(sumTokA/n));
console.log('  MEAN  Scheme B (maximal 1-char/token): char', pct(sumCharB/n), ' token-proxy', pct(sumTokB/n));
console.log('\n  Scheme C (whole-program → 1 glyph) hits ~' + Math.round(PROGRAMS['long-literals'].length) + '× on a KNOWN program');
console.log('  and exactly 1× on any unseen program — a per-corpus lookup table, not compression that generalises.');
console.log('\n  VERDICT: 15× does NOT hold on general KonomiLang input. Real, generalising compression is');
console.log('  ' + pct(sumCharA/n) + '–' + pct(sumCharB/n) + ' (char) because prompt literals are irreducible information.');
