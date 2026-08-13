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

## Your own replacements

One **Replacement string** for every invalid character turns `Report: Q1` into `Report_ Q1`,
whether or not that is what you wanted. **Name transform template** lets you say what each
character should become instead. It rewrites the name before the invalid characters are dealt
with, and it applies to split and extract targets, the merged note name, and
`Create folder with notes...` alike.

`{{rawString}}` is the name as you typed it. With Templater installed the same value is
available as `TOKENS.rawString`, which is what lets you write a real mapping:

```text
<% TOKENS.rawString.replaceAll(": ", " - ") %>
```

The template must produce a **single line** - chain your replacements instead of writing one
command per line. Each command emits its own result, so two lines produce a two-line name,
which no file name can be; the operation is refused with a message saying so:

```text
<% TOKENS.rawString.replaceAll(": ", " - ").replaceAll("?", "_") %>
```

Characters your template does not map are still governed by **Should replace invalid
characters**: on, they take the **Replacement string**; off, a name that still contains them is
refused rather than rewritten - so nothing is replaced except what you asked for.

The block below sets a transform that maps a colon-and-space to a spaced dash. Manual equivalent: type it into **Name transform
template** in **Settings -> Advanced Note Composer**. Then run `Create folder with notes...` and type
`Alpha: Beta` - the folder is created as `Alpha - Beta`, not `Alpha_ Beta`.

```code-button
---
caption: Map ": " to " - ", then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { nameTransformTemplate: '<% TOKENS.rawString.replaceAll(": ", " - ") %>' });
```

## Settings

- **Frontmatter title mode**
  - `None`, `UseAlways`, or `UseForInvalidTitleOnly`.
- **Should add invalid title to note aliases**
  - keep the original title reachable from the Quick switcher.
- **Name transform template**
  - your own replacements, applied before anything else.

The block below switches to always writing a frontmatter `title`. Manual equivalent: set **Frontmatter title mode** to
`UseAlways` in **Settings → Advanced Note Composer**.

```code-button
---
caption: Always write a frontmatter title, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { frontmatterTitleMode: 'UseAlways' });
```
