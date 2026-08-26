# Treat title as path

A heading that contains `/` can become a **nested path** instead of a file with underscores.

## Try it

1. Put the cursor in the `## a / b / c / d` section below.
2. Run `Extract this heading...`.
3. With **Treat title as path** enabled (the default here), the new note is `a/b/c/d.md` - nested folders. With it disabled, you get a single file `a _ b _ c _ d.md`.

So for `## a / b / c / d`, with the setting

- **enabled**
  - the split file is `a/b/c/d.md`. Leading and trailing spaces around each part are trimmed.
- **disabled**
  - the split file is `a _ b _ c _ d.md`. Spaces are preserved, and `/` is replaced with `_` — or whatever **Replacement string** says, see [28 Invalid titles](<../09 Titles, links and frontmatter/28 Invalid titles.md>).

## a / b / c / d

Extract this heading and watch where the file lands.

## Switch the setting

The block below turns **Treat title as path** off. Manual equivalent: toggle **Should treat title as path** in **Settings → Advanced Note Composer**, then extract the heading again to compare.

```code-button
---
caption: Turn "treat title as path" off
---
await require('/demoSetup.ts').changeSettings(app, { shouldTreatTitleAsPathByDefault: false });
```
