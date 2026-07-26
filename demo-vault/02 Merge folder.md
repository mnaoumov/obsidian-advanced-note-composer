[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Merge folder

Merge **every note in a folder** into a single target note, in order.

## Try it

1. Open any note inside the `Merge folder` folder - for example [[Chapter 1]].
2. Run `Merge current folder with another folder...`.
3. Pick a target folder (or a new one) and confirm.

The chapters - [[Chapter 1]], [[Chapter 2]], and [[Chapter 3]] - are combined into
[[Book]]. Watch the `chapter` tags collapse according to your frontmatter merge strategy,
and the footnote in Chapter 3 stay intact.

## Options

The confirmation step lets you include child folders and parent folders. Toggle
**Should include child folders when merging folders** and **Should include parent folders
when merging folders** in **Settings → Advanced Note Composer** to change the defaults.

## Excluded items

By default, folder merge **skips** items whose path is excluded/ignored in the plugin settings and
reports them in a notice, so no stray empty target is left behind. Turn on **Should always merge
excluded items** to move and merge those items too (no "ignored" notice). Manual equivalent: toggle
**Should always merge excluded items** in **Settings → Advanced Note Composer**.

```code-button
---
caption: Always merge excluded items, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldAlwaysMergeExcludedItems: true });
```
