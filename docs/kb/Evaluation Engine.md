---
type: tool
tags: [tool, ai, scoring]
updated: 2026-08-03
---

# Evaluation Engine

The scoring brain. Markdown prompt files define *how* to judge a role; the AI
(any CLI) applies them to the JD + the user's CV and writes a structured report.

## The prompt core

- `modes/oferta.md` — the A–G evaluation blocks
- `modes/_shared.md` — the 1–5 scoring system, archetype detection, posting
  legitimacy signals, global rules

## Scoring model

Weighted average across dimensions, 1–5. **Below 4.0 → recommend against
applying.** The score drives the tracker and the "should I apply" decision
([[Security & Human-in-the-loop]]).

## Output

`reports/{NNN}-{company}-{date}.md`, registered into
[[Application Tracker]]. Standalone evaluators (`gemini-eval.mjs`,
`ollama-eval.mjs`, `openai-eval.mjs`) run the same scoring on cheaper/local
models.

## Related files

- `modes/oferta.md`, `modes/_shared.md`
- `reports/`

## Links

- [[Application Tracker]] — where scores land
- [[Data Contract]] — reports are canonical files
- [[CV & PDF Generation]] — personalisation per evaluation
- [[Security & Human-in-the-loop]] — the 4.0 bar
- [[Job Scanning]] — the discovery front-end
