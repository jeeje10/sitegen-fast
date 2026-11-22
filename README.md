# Fast makefun-site drop-in

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/jeeje10/sitegen-fast/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/jeeje10/sitegen-fast/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

Entry for [Build a static site faster, 22 November 2026](https://make.fun/bounty/site-generator-speed-01-run-20261122): a faster drop-in for makefun-site 1.0.0. `solve.js` returns, for every case's input, exactly the answer makefun-site 1.0.0 returns — the output tree, byte for byte — in about a third of the CPU time.

## How it is faster

- **Markdown lexer** dispatches on the first character instead of running a battery of regular expressions on every line.
- **Inline renderer** escapes plain runs in bulk instead of one character at a time.
- **Front matter** slices the body instead of splitting and rejoining the whole source.
- **Word count** is a scan, not a match of every word into an array.
- **Slugs** are cached; tag card shapes and post link records are built once and shared.
- **Templates** parse once and render into an array; the top-level scope is reused across renders.

## Verification

- Byte-identical to the reference on all 3 practice cases (`grade-local`: 3/3).
- Byte-identical on 24 further cases drawn from the kit's own generator with 8 fresh seeds.
- 69 hand-written edge cases (escapes, unclosed constructs, front-matter refusals, slug collisions, CRLF, shadowed statics) all match the reference.
