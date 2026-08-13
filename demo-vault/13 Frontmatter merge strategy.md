# Frontmatter merge strategy

When two notes are merged, their frontmatter has to be reconciled. Advanced Note Composer
offers five strategies.

## Try it

1. Pick a strategy with one of the buttons below (or set **Frontmatter merge strategy** in
   **Settings → Advanced Note Composer** manually).
2. Open [Incoming](<./Frontmatter examples/Incoming.md>) in the `Frontmatter examples` folder.
3. Run `Merge current file with another file...` and pick [Original](<./Frontmatter examples/Original.md>).
4. Inspect the resulting frontmatter - `title`, `status`, and `tags` resolve differently
   per strategy.

The two notes conflict on `title` and `status`, share the `tags` key with different values,
and each has a unique key (`author` vs `year`), so every strategy produces a visibly
different result.

```code-button
---
caption: Prefer new values, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { defaultFrontmatterMergeStrategy: 'MergeAndPreferNewValues' });
```

```code-button
---
caption: Prefer original values, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { defaultFrontmatterMergeStrategy: 'MergeAndPreferOriginalValues' });
```

```code-button
---
caption: Keep original frontmatter, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { defaultFrontmatterMergeStrategy: 'KeepOriginalFrontmatter' });
```

```code-button
---
caption: Replace with new frontmatter, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { defaultFrontmatterMergeStrategy: 'ReplaceWithNewFrontmatter' });
```

```code-button
---
caption: Preserve both, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { defaultFrontmatterMergeStrategy: 'PreserveBothOriginalAndNewFrontmatter' });
```

## Extracting properties as properties

Selecting a couple of values inside a note's properties and running `Extract current selection...`
used to paste those raw YAML lines into the destination note's **body**, where they are just text.
With **Should extract a properties selection as properties** (on by default), a selection that lies
entirely inside the properties block is merged into the destination note's own properties instead —
through the same strategy every other merge uses, so everything above applies to it.

The selection is a set of **values**, not whole properties, so the property each value belongs to is
carried across with it. Selecting `alpha` and `bravo` in

```yaml
---
aliases:
  - alpha
  - bravo
  - charlie
tags:
  - keep
---
```

adds them to the destination's own `aliases`, and leaves the source with `charlie` and its `tags`
intact.

- Every property line the selection touches is taken **in full**
  - a selection starting halfway through a value still moves that whole value.
- A property left with no values of its own is removed from the source
  - rather than being left dangling.
- Everything the selection did not touch is kept byte for byte
  - comments, key order, quoting and indentation style all survive.
- **Text after extraction** is not applied
  - a link or an embed is not valid YAML.
- Anything else falls back to the previous behavior
  - a selection reaching out of the properties block, or lines that do not parse into properties,
    is extracted as raw text.
- Smart cut & paste moves are unaffected
  - they insert at the cursor you place in the note's body.
- Extracting a note's properties into that same note is refused
  - they are already there.
