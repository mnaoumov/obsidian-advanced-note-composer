[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Frontmatter merge strategy

When two notes are merged, their frontmatter has to be reconciled. Advanced Note Composer
offers five strategies.

## Try it

1. Pick a strategy with one of the buttons below (or set **Frontmatter merge strategy** in
   **Settings → Advanced Note Composer** manually).
2. Open [[Incoming]] in the `Frontmatter examples` folder.
3. Run `Merge current file with another file...` and pick [[Original]].
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
