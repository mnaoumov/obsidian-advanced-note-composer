# Extract selection

Pull part of a note out into another note. Three commands cover the common cases.

## Extract the current selection

1. Select the paragraph below the horizontal rule.
2. Run `Extract current selection...`.
3. Type a new name (the switch at the top says `Create`), then confirm.

What is left behind (a link, an embed, or nothing) is controlled by
[07 Text after extraction](<../02 Extract/07 Text after extraction.md>). Whether the target is created or merged into is
[the switch at the top of the picker](<../03 Split/10 Create or merge when splitting.md>).

---

Select me and extract me into a brand-new note. Because **Text after extraction** defaults
to *link*, a link to the new note is left here in my place.

## Extract before / after the cursor

- Place the cursor anywhere and run `Extract before cursor...` to move everything above
  the cursor into another note.
- Or run `Extract after cursor...` to move everything below it.

A selection made inside a note's **properties** is a special case: it is merged into the destination's
own properties rather than pasted into its body — see
[30 Frontmatter merge strategy](<../09 Titles, links and frontmatter/30 Frontmatter merge strategy.md>).

## Same-note extraction

The picker also offers the **current** note as a target: press `Enter` to send the
selection to the bottom, or `Shift+Enter` to send it to the top. Sending it into the note
you are already in is a merge into an existing note, so flip the switch to `Merge` first —
see [10 Create or merge when splitting](<../03 Split/10 Create or merge when splitting.md>).
