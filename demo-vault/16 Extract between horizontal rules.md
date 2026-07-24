[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Extract between horizontal rules

Extract the block of content **between the horizontal rules closest to the cursor** into its own
note - no manual selection needed, which is especially handy on mobile. The bounding rules stay put.

The rules can be written as `---`, `***`, `___`, or their spaced/longer variants (`- - -`). Obsidian's
own parser is used to find them, so `---` inside a code block and the frontmatter delimiters are never
mistaken for a rule.

## Try it

1. Put the cursor anywhere inside the **middle** section below ("Section to extract").
2. Run `Extract between horizontal rules...`.
3. Confirm - a new note is created with just that section's content, a link is left in its place, and
   the `---` rules stay exactly where they were.

The note's start and end act as boundaries too: with the cursor in the closing section below the last
rule, everything from that rule to the end of the note is extracted. (With the cursor above the *first*
rule, everything from the top of the note - including this heading - down to that rule would be taken, so
the middle section is the tidiest one to try first.)

---

## Section to extract

This section - and only this section, everything between the two rules - moves to the new note when the
cursor is here. The rules above and below it remain behind.

---

Closing paragraph below the last rule. With the cursor here, everything from the last rule to the end of
the note is extracted.
