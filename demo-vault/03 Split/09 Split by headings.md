# Split by headings

Break one note into many, one per heading of a chosen level.

## Try it

1. Open [Fruit](<../Materials/09 Split by headings/Fruit.md>) and put the cursor inside its `Apples` section.
2. Run `Split note by headings - H2`, and confirm each split as it asks.
3. Each `##` section becomes its own note (the heading line is included): `Apples`, `Oranges` and `Pears`, at the top of the vault.

The first button below does steps 1 and 2 up to the first confirmation. The second puts **Fruit** back and deletes the three notes the split created.

```code-button
---
caption: Split Fruit by its H2 headings
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'split-note-by-headings-h2', cursorBefore: 'Everything under this heading is one note', notePath: 'Materials/09 Split by headings/Fruit.md' });
```

```code-button
---
caption: Put Fruit back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/09 Split by headings', 'Apples.md', 'Oranges.md', 'Pears.md']);
```

Use `Split note by headings content - H2` instead to move only the **content** under each heading. Whether the heading line is kept is controlled by **Should keep headings when splitting content**.

## Smarter right-click menu

The `Split note by headings - H<n>` items now appear in the editor right-click menu only when your cursor or selection actually sits inside a heading of that level. Right-click inside an `##` section of [Fruit](<../Materials/09 Split by headings/Fruit.md>) and you will see the **H2** item (and **H1**, since the section is nested under `# Fruit`); right-click the line under its title — under no `##` heading — and the **H2** item is not there. The same gate applies to the command palette.

The block below flips that setting for you. Manual equivalent: toggle **Should keep headings when splitting content** in **Settings → `Advanced Note Composer`**.

```code-button
---
caption: Toggle "keep headings when splitting content" off
---
await require('/demoSetup.ts').changeSettings(app, { shouldKeepHeadingsWhenSplittingContent: false });
```
