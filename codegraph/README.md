# OpenProject code graph

This directory contains a reproducible, dependency-free code graph generator
and regenerated JSON graphs for the OpenProject source tree.

## Artifacts

- `openproject-code-graph.json`: machine-readable file graph. Nodes are tracked
  source files and plugin modules. Edges come from Ruby requires, JavaScript or
  TypeScript imports, and module gem dependencies.
- `openproject-architecture-graph.json`: compact graph used to render the
  editable architecture diagram.
- `openproject-architecture.drawio`: optional editable high-level architecture
  diagram generated from the compact JSON graph.

The generator intentionally skips tests, fixtures, locale catalogs, vendored
dependencies, generated source maps, and binary assets. Rails autoloaded
constant references and runtime metaprogramming cannot be resolved reliably by
this lightweight static pass, so they are not emitted as file-level edges.

## Regenerate

Run from the repository root:

```bash
python3 codegraph/generate.py
```

The command uses only the Python standard library and Git. Its output is
deterministic for the same commit and sparse working tree. Repository metadata
is read from the checkout's `origin` remote, so fork artifacts are not labeled
as upstream OpenProject artifacts. `base_commit` identifies the checkout base;
`source_tree_sha256` identifies the exact materialized source content, including
uncommitted integration changes.

To render the architecture graph with the bundled draw.io skill tools:

```bash
python3 "$HOME/.codex/skills/drawio-skill/scripts/autolayout.py" \
  codegraph/openproject-architecture-graph.json \
  -o codegraph/openproject-architecture.drawio
python3 "$HOME/.codex/skills/drawio-skill/scripts/validate.py" \
  codegraph/openproject-architecture.drawio --score
```

The full checkout is optional for this graph. To add omitted source areas later:

```bash
git sparse-checkout add '/spec/' '/docs/development/'
```
