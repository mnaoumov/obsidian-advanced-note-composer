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

Want only one section restructured instead of the whole note? That is
[[32 Split heading recursively]].

## Right-click with a selection

Select some text first and right-click it: this command is **not** in the menu (issue #188). A
selection is a question about the selection, not about the whole note, so the selection-scoped commands
are what you get. Click once to drop the selection and the command is back. Only the context menu hides
it — the command palette and any hotkey you assigned still run it with a selection active.

## Build the tree somewhere else

By default the tree lands next to the note you split. Turn on `Should split recursively into the
default new note folder` (in the plugin settings, under `Split/extract`) and it is built in Obsidian's
own `Default location for new notes` instead — set that under `Settings -> Files and links -> Default
location for new notes`.

Only the *top* of the tree moves there. `Trip` would land in that folder, while `Packing`,
`Electronics` and `Itinerary` still nest inside it exactly as above — the hierarchy is kept, not
flattened. This note itself is never moved; it stays put and links down into the new tree.

Nothing changes while Obsidian's own setting is `Same folder as current file`, because that is already
where the tree would have been built.

Neither answer is a setting you have to commit to. With `Should ask before splitting` on, the
confirmation dialog names the folder the tree will be rooted in, and `Change target` (or `Alt+C`) picks
a different one for this run. Only the root moves: every note below it still nests under its own
parent, and every note's *name* still comes from its heading, which you do not get to change here.

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
