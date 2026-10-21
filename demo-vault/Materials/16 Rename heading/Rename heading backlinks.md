---
obsidian-dev-toolkit:
  demo-vault-validation:
    allow-wikilinks: These links ARE the backlinks the heading rename rewrites, including a nested-heading spelling only a wikilink has.
---
# Rename heading backlinks

Links into [16 Rename heading](<../../04 Headings/16 Rename heading.md>) that are rewritten when a heading there is renamed. They stay wikilinks on purpose: they are the fixture the command acts on.

- Nested (middle segment renamed): [[16 Rename heading#Second Concept#Definition]]
- Single segment: [[16 Rename heading#Second Concept]]
- Block reference (left untouched by a heading rename): [[16 Rename heading#^example]]
