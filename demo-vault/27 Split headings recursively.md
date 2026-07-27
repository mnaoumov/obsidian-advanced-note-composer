[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Split headings recursively

`Split note by headings - H2` extracts one level. This command extracts *all* of them, and keeps the
nesting: every heading becomes a folder holding a note of the same name, and a sub-heading becomes a
folder inside its parent's folder.

## Try it

1. Put the cursor anywhere in this note and run `Split note by headings recursively...`.
2. A dialog lists every note it is about to create, indented the way it will be nested. Press `Split`.
3. Look in the file explorer. The `Trip` section below has become:

```text
Trip/
  Trip.md
  Packing/
    Packing.md
    Electronics/
      Electronics.md
  Itinerary/
    Itinerary.md
```

Each note keeps its own heading and its own body text; the sections nested under it moved out into
their own notes, leaving a link behind — so you can click your way down the tree.

Two things this command does *not* care about:

- **`Should split into folder`.** It builds the folder tree either way. A recursive split with no
  folders could not express a hierarchy, so the setting only governs ordinary splits.
- **Where your cursor is, or which heading level you start from.** It begins at the shallowest heading
  the note actually has. The `Notes` section below jumps straight from `##` to `####`, and still nests
  correctly.

It asks once, not once per note — `Should ask before splitting` controls that single dialog.

## Trip

Everything about the trip lives here.

### Packing

What to bring.

#### Electronics

Chargers, adapters, headphones.

### Itinerary

Day by day.

## Notes

This section skips a level on purpose.

<!-- markdownlint-disable-next-line MD001 -- The skipped heading level is what this section demonstrates. -->
#### Loose end

There is no `###` above this one, so it becomes a direct child of `Notes`.
