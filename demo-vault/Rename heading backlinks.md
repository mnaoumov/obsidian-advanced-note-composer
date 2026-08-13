---
obsidian-dev-utils:
  demo-vault-validation:
    allow-wikilinks: These links ARE the backlinks the heading rename rewrites, including a nested-heading spelling only a wikilink has.
---
# Rename heading backlinks

Links into [22 Rename heading](<./22 Rename heading.md>) that are rewritten when a heading there is
renamed. They stay wikilinks on purpose: they are the fixture the command acts on.

- Nested (middle segment renamed): [[22 Rename heading#Second Concept#Definition]]
- Single segment: [[22 Rename heading#Second Concept]]
- Block reference (left untouched by a heading rename): [[22 Rename heading#^example]]
