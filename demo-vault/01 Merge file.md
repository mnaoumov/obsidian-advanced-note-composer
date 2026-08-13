# Merge file

Merge the **whole current note** into another note. Advanced Note Composer fixes relative
links, renumbers footnotes, and merges frontmatter along the way.

## Try it

1. Open this note.
2. Run `Merge current file with another file...` from the Command Palette.
3. In the picker, choose [Merge target](<./Merge target.md>).
4. Confirm the dialog.

The body of this note is appended to **Merge target**, and the two notes' frontmatter is
combined using your **Frontmatter merge strategy** (see [13 Frontmatter merge strategy](<./13 Frontmatter merge strategy.md>)).

## Attachments follow the note

**Should move attachments when merging a file** (under `Merge`, on by default) makes the attachments a
note owns follow it when the note is merged away — otherwise they would be left behind in a folder the
note no longer lives in. It applies to
[`Merge these files into one file...`](<./24 Merge multiple files.md>) too.

An attachment moves when the merged note references it and **no other note does**; one that several
notes share belongs to none of them and stays where it is. The destination comes from your vault's own
attachment settings, so
[Custom Attachment Location](https://github.com/mnaoumov/obsidian-custom-attachment-location) is
honored when you have it installed — this plugin never computes attachment paths itself. Attachments
move inside the merge's own transaction, so cancelling the merge puts them back.

## Content to merge

This paragraph, and the footnote below[^demo], travel into the target note when you merge.

[^demo]: This footnote is renumbered if the target already has footnotes - proof that
    footnote fixing works.
