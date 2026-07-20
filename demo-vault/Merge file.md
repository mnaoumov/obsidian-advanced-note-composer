[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Merge file

Merge the **whole current note** into another note. Advanced Note Composer fixes relative
links, renumbers footnotes, and merges frontmatter along the way.

## Try it

1. Open this note.
2. Run `Merge current file with another file...` from the Command Palette.
3. In the picker, choose [[Merge target]].
4. Confirm the dialog.

The body of this note is appended to **Merge target**, and the two notes' frontmatter is
combined using your **Frontmatter merge strategy** (see [[Frontmatter merge strategy]]).

## Content to merge

This paragraph, and the footnote below[^demo], travel into the target note when you merge.

[^demo]: This footnote is renumbered if the target already has footnotes - proof that
    footnote fixing works.
