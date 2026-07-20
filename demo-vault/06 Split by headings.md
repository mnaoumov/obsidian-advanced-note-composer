[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Split by headings

Break one note into many, one per heading of a chosen level.

## Try it

1. Run `Split note by headings - H2` from this note.
2. Each `##` section below becomes its own note (the heading line is included).

Use `Split note by headings content - H2` instead to move only the **content** under each
heading. Whether the heading line is kept is controlled by **Should keep headings when
splitting content**.

The block below flips that setting for you (needs the [[16 CodeScript Toolkit prerequisite]]).
Manual equivalent: toggle **Should keep headings when splitting content** in
**Settings → Advanced Note Composer**.

```code-button
---
caption: Toggle "keep headings when splitting content" off, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldKeepHeadingsWhenSplittingContent: false });
```

## Apples

Everything under this heading is one note after a split.

## Oranges

And this is another. Split by H2 and you get one note per fruit.

## Pears

A third section, so the split clearly produces several notes.
