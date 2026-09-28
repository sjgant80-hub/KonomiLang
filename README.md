# KonomiLang — sovereign interpreter

**▶ Live: https://sjgant80-hub.github.io/KonomiLang/**

A sovereign, in-browser interpreter for **KonomiLang** — the small language for AI
interactions (`let` / `ask` / `if` / arithmetic / comparison). It runs entirely in your
tab, zero dependencies, offline-capable, and its logic is the **mutation-gated kernel**
(`konomi.mjs`) — the gated code IS the live code.

## Provenance — the base language is Thomas Frumkin's

**KonomiLang is Thomas Frumkin's language**, the OG Konomi language for AI interactions,
first published 2024-11-20 at
[teslasolar/KonomiLang](https://github.com/teslasolar/KonomiLang) (authored as
`frumkin89`, Konomi / konomi.ai). **The base language is his.** This repository's
contribution — the sovereign in-browser interpreter, the witness mutation gate, and the
honestly-measured symbolic-compression layer — is the estate's upgrade, built on the
Konomi architecture he created and with his permission. The MACCubeFACE / Konomi Cube
lattice ([teslasolar/MianoCube](https://github.com/teslasolar/MianoCube)) is also his.
See [NOTICE](NOTICE). Powered by the Konomi architecture, created by Thomas Frumkin.

## What it does

- **Write and run KonomiLang in the browser.** `let` binds variables; `ask` records the
  resolved prompt a program would send to a model; `if/else`, arithmetic and comparison
  work as you'd expect. `run(src)` returns the exact ordered prompts plus the final
  variable state — deterministically, with no model call at the gated floor. A local
  model (WebLLM / BYOK) can answer the recorded prompts at the edge.
- **Total and pure.** Garbage in returns `{ ok: false, error }` — it never throws.
  Divide-by-zero yields 0; an undeclared variable reads as 0.
- **Symbolic compression, measured — not asserted.** A compact symbol map (`§`=let,
  `≫`=ask, `¿`=if, `¬`=else) expands to KonomiLang and runs; the page reports the **real
  ratio for your program**, computed live. On keyword substitution this measures ~1.35×.
  Higher ratios need whole-pattern symbol tokens (the κΨ∞ design direction); the number
  shown is always the true one for what is implemented, never a fixed marketing claim.

## Proof (no test-theatre)

The interpreter is proven, not asserted:

- `konomi.test.mjs` — the unit suite (the documented example, every operator, totality).
- **witness mutation gate** — `node .witness/witness.mjs mutate konomi.mjs --cap 500
  --test node --test`. It flips each operator in the kernel and requires a test to catch
  it. The gate is **CLEAN**: every unguarded mutant is killed; the only survivors are
  five *proven-equivalent* mutants, each recorded with a written reason in
  [`witness.baseline.json`](witness.baseline.json) (loop bounds that read one index past
  the end where the inner guard already rejects it, and one block-end conjunction).
- Both run in CI on every push (`.github/workflows/gate.yml`) — a green run on GitHub's
  own runner is the un-forgeable proof of the code.

Run it yourself:

```
node --test konomi.test.mjs
node .witness/witness.mjs mutate konomi.mjs --cap 500 --test node --test
```

## Sovereign by design

- **MIT licensed** — no revocation, no per-seat pricing. Fork it; every commit is public.
- **No telemetry, runs offline** — save the page to disk and keep it forever.
- **Kernel-backed** — the page imports the same `konomi.mjs` the gate proves.

## Related

- OG language: https://github.com/teslasolar/KonomiLang (Thomas Frumkin)
- Konomi Cube lattice: https://github.com/teslasolar/MianoCube (Thomas Frumkin)
- Machine summary: [llms.txt](llms.txt)

## License

MIT — the estate's own code only (see [LICENSE](LICENSE)). The KonomiLang language and
the Konomi architecture are Thomas Frumkin's; credit is recorded in [NOTICE](NOTICE).
