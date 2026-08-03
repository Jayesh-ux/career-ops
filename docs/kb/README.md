# Knowledge Base — Graphify/Obsidian Vault

This folder is an **Obsidian vault** that maps the career-ops architecture as an
interconnected knowledge graph. Every note links to its dependents and
dependencies with `[[wikilinks]]`, so tools like **Graphify** render the whole
system as a navigable graph instead of flat docs.

## Why

Flat docs (ARCHITECTURE.md) describe a system top-down. A graph shows the same
system the way code actually is — as a web of dependencies. When you're
developing faster, you can:

- Jump from "this endpoint" to the script it spawns to the Android screen that
  calls it.
- See which subsystem depends on which (e.g. Portal Session ← Playwright ←
  Auto-fill ← Bridge ← Android).
- Trace the one-time login story across three layers (Android UX, Bridge HTTP,
  Playwright browser) in one view.

## How to open

1. **Obsidian**: "Open folder as vault" → select this `docs/kb/` directory.
2. Enable the **Graphify** community plugin (or the built-in graph view).
3. Open the graph → all notes appear as nodes, `[[wikilinks]]` as edges.
4. Filter by `type` tag (component / flow / boundary / tool) to slice the graph.

## Graph legend (YAML frontmatter `type`)

| type       | Meaning                                  | Example                |
|------------|------------------------------------------|------------------------|
| `hub`      | Index / map of content                   | CareerOps Hub          |
| `component`| A runtime piece (server, app, script)    | Bridge Server          |
| `flow`     | A user journey across components         | Onboarding Flow        |
| `boundary` | A rule or contract that shapes the design| Google OAuth           |
| `tool`     | A build/support utility                  | System Updater         |

## Maintenance

Every note has a `## Related files` section naming the real files it maps to.
When you change those files, update the note and the wikilinks so the graph
stays truthful. Start editing from the [[CareerOps Hub]].
