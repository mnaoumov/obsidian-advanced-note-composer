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

`{{rawString}}` is the name as you typed it. With
[Templater](https://silentvoid13.github.io/Templater/) installed the same value is
available as `TOKENS.rawString`, which is what lets you write a real mapping:

```text
<% TOKENS.rawString.replaceAll(": ", " - ") %>
```

Conditional mappings are ordinary JavaScript, so one template can handle as many characters as you
like. Templater is only needed for the logic — a template made purely of `{{tokens}}` works on its own.

**You do not need a note open.** A Templater run has to report on some note through `tp.file`, so the
plugin uses the one you have open, and when you have none, the last note you opened, or failing that
the last one you edited. Only a vault with no notes in it at all has nothing to offer, and that is the
one case the template is refused. This matters for the commands that work on a *folder* —
[`Create folder with notes...`](<../06 Folder operations/22 Create folder with notes.md>) and
[`Merge current folder contents into a single file...`](<../01 Merge/03 Merge folder into single file.md>) — which
have no note of their own and used to refuse outright whenever nothing was focused.

The template must produce a **single line** - chain your replacements instead of writing one
command per line. Each command emits its own result, so two lines produce a two-line name,
which no file name can be; the operation is refused with a message saying so:

```text
<% TOKENS.rawString.replaceAll(": ", " - ").replaceAll("?", "_") %>
```

Characters your template does not map are still governed by **Should replace invalid
characters**: on, they take the **Replacement string**; off, a name that still contains them is
refused rather than rewritten - so nothing is replaced except what you asked for.

A broken template is reported where you can see it: the `Create folder with notes...` prompt shows the
error and asks again, and the other commands stop rather than create a note under a name you did not
intend.

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
