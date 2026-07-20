[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Extract selection

Pull part of a note out into another note. Three commands cover the common cases.

## Extract the current selection

1. Select the paragraph below the horizontal rule.
2. Run `Extract current selection...`.
3. Choose an existing note or type a new name, then confirm.

What is left behind (a link, an embed, or nothing) is controlled by
[[Text after extraction]].

---

Select me and extract me into a brand-new note. Because **Text after extraction** defaults
to *link*, a link to the new note is left here in my place.

## Extract before / after the cursor

- Place the cursor anywhere and run `Extract before cursor...` to move everything above
  the cursor into another note.
- Or run `Extract after cursor...` to move everything below it.

## Same-note extraction

The picker also offers the **current** note as a target: press `Enter` to send the
selection to the bottom, or `Shift+Enter` to send it to the top.
