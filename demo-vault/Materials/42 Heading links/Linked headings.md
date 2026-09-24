---
obsidian-dev-utils:
  demo-vault-validation:
    allow-wikilinks: These links ARE the heading and block links a split keeps pointing at the right note, including block and aliased forms.
---
# Linked headings

The introduction points at [[#Second]] and at [[#Third]].

## First

The first heading points at [[#Second]], and at a block under the third one: [[#^quote]].

### Second

The second heading points back at [[#First]] and on to [[#Third]].

#### Third

A quoted line to link to. ^quote

### Fourth

The fourth heading points at [[#Second|the second heading]].
