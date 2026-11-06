# Merge file

Merge the **whole current note** into another note. `Advanced Note Composer` fixes relative links, renumbers footnotes, and merges frontmatter along the way.

## Try it

1. Open this note.
2. Run `Merge current file with another file...` from the Command Palette.
3. In the picker, choose [Merge target](<../Materials/01 Merge file/Merge target.md>).
4. Confirm the dialog.

The first button below does steps 1 and 2 for you, so all that is left is to pick **Merge target** and confirm.

```code-button
---
caption: Merge this note into another one
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'merge-file', notePath: '01 Merge/01 Merge file.md' });
```

The body of this note is appended to **Merge target**, and the two notes' frontmatter is combined using your **Frontmatter merge strategy** (see [30 Frontmatter merge strategy](<../09 Titles, links and frontmatter/30 Frontmatter merge strategy.md>)).

The merge deletes this note — its body, buttons included, now sits at the bottom of **Merge target**. Click the button below there (or **Reset the whole demo vault** in [00 Start](<../00 Start.md>)) to bring this note back and put **Merge target** as it was.

```code-button
---
caption: Put this note and Merge target back
---
await require('/demoSetup.ts').resetDemo(app, ['01 Merge/01 Merge file.md', 'Materials/01 Merge file']);
```

## Merge back where it came from

When the destination links to the merged note exactly once, with the link alone on its line, the note goes **in place of that link** instead of to the bottom. That is the link an extract leaves behind, so extracting a heading, working on it in its own note, and merging it back puts it where it was. The confirmation dialog names the line it will replace.

The picker's `Merge at the link to the source` checkbox (`Alt+6`) turns it off for one merge, and **Should merge at the link to the source by default** (under `Merge`, `Merge file`, on by default) for every merge. Several links to the note, a heading link, or a link inside a sentence keep the usual bottom or top.

## Attachments follow the note

**Should move attachments when merging a file** (under `Merge`, on by default) makes the attachments a note owns follow it when the note is merged away — otherwise they would be left behind in a folder the note no longer lives in. It applies to [`Merge these files into one file...`](<../01 Merge/04 Merge multiple files.md>) too.

An attachment moves when the merged note references it and **no other note does**; one that several notes share belongs to none of them and stays where it is. The destination comes from your vault's own attachment settings, so [Custom Attachment Location](https://github.com/mnaoumov/obsidian-custom-attachment-location) is honored when you have it installed — this plugin never computes attachment paths itself. Attachments move inside the merge's own transaction, so cancelling the merge puts them back.

## Content to merge

When `Permanent Links` is enabled with API 1.1.0 or newer, merging transfers the source note's keys and aliases to the destination before deleting the source. The destination keeps its primary key, even with **Replace with new frontmatter**. A failed transfer stops the merge and keeps the source note. This applies to every merge that combines notes, including folder merges.

This paragraph, and the footnote below[^demo], travel into the target note when you merge.

[^demo]: This footnote is renumbered if the target already has footnotes - proof that footnote fixing works.
