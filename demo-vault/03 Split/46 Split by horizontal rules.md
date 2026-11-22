# Split by horizontal rules

Break one note into many at its horizontal rules: every block between two rules, or between a rule and the start or end of the note, becomes a note of its own. It is the batch sibling of [08 Extract between horizontal rules](<../02 Extract/08 Extract between horizontal rules.md>), which takes one block at a time.

Each new note is named after the block's **first heading**, or, when the block has none, after its **first line** with its markdown markup dropped and cut to 100 characters.

## Try it

1. Open [Travel log](<../Materials/46 Split by horizontal rules/Travel log.md>).
2. Run `Split note by horizontal rules`, and confirm each split as it asks.
3. Its three blocks become `Monday`, `Tuesday was spent in the old town, with a long lunch by the river` and `Wednesday`, at the top of the vault. **Travel log** keeps a link to each, with the rules still between them.

The first button below does steps 1 and 2 up to the first confirmation. The second puts **Travel log** back and deletes the three notes the split created.

```code-button
---
caption: Split Travel log by its horizontal rules
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'split-note-by-horizontal-rules', cursorBefore: 'Arrived in the city', notePath: 'Materials/46 Split by horizontal rules/Travel log.md' });
```

```code-button
---
caption: Put Travel log back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/46 Split by horizontal rules', 'Monday.md', 'Tuesday was spent in the old town, with a long lunch by the river.md', 'Wednesday.md']);
```

## Good to know

- The rules stay where they were
  - only the blocks between them move.
- The frontmatter is never part of a block
  - it stays with the note being split.
- A block holding only blank lines is skipped.
- In a note with no horizontal rule
  - the command is not offered at all.
- What is left in place of each block follows [07 Text after extraction](<../02 Extract/07 Text after extraction.md>), and **Should split headings automatically** skips the confirmations, as it does for [09 Split by headings](<./09 Split by headings.md>).

The idea comes from the `Splitsmith` plugin.
