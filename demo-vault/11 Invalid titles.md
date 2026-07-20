[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer#invalid-titles)

# Invalid titles

Headings can contain characters that are illegal in file names. The core plugin refuses to
extract them; Advanced Note Composer cleans them up instead.

## Try it

1. Put the cursor in the `## Title with invalid characters` section below.
2. Run `Extract this heading...`.
3. The invalid characters are replaced (or removed), and - depending on your settings - the
   original title is preserved as a note **alias** or a frontmatter **title**.

## Title with invalid characters *\<>:|?#^[]"

The heading above uses characters that cannot appear in a file name. Extract it and see how
the resulting file is named, and where the original title is preserved.

## Settings

- **Frontmatter title mode** - `None`, `UseAlways`, or `UseForInvalidTitleOnly`.
- **Should add invalid title to note aliases** - keep the original title reachable from the
  Quick switcher.

The block below switches to always writing a frontmatter `title` (needs the
[[CodeScript Toolkit prerequisite]]). Manual equivalent: set **Frontmatter title mode** to
`UseAlways` in **Settings → Advanced Note Composer**.

```code-button
---
caption: Always write a frontmatter title, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { frontmatterTitleMode: 'UseAlways' });
```
