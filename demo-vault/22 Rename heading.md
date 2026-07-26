[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Rename heading

Rename a heading and update **every link that points to it across the vault** - including a link
whose **nested subpath** references the heading only as a middle segment, e.g.
`[[note#Second Concept#Definition]]`. Obsidian's built-in `Rename this heading` command updates
single-segment links but leaves those nested links broken (issue #111); this command fixes both, at
the start, middle, or end of a nested subpath. Block references (`#^id`) and links that do not
reference the heading are left untouched.

## Try it

1. Put the cursor on the `## Second Concept` heading line below.
2. Run `Rename heading...` and enter `New Concept`.
3. The heading is renamed **and** the links in [[Rename heading backlinks]] are rewritten:
   - `[[22 Rename heading#Second Concept#Definition]]` becomes
     `[[22 Rename heading#New Concept#Definition]]`
   - `[[22 Rename heading#Second Concept]]` becomes `[[22 Rename heading#New Concept]]`

> [!NOTE] Duplicate headings
>
> Matching is by heading **text** (mirroring Obsidian's own heading-link matching), so if a note has
> two identically named headings, links to either are updated.

## First Concept

### Definition

The first definition. Linked as `First Concept#Definition`.

## Second Concept

### Definition

The second definition - disambiguated in links as `Second Concept#Definition`.
