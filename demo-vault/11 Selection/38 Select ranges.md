# Select ranges

Five commands that set the selection and do nothing else. They compute exactly the ranges the matching `Extract ...` commands use — so `Select this heading` selects precisely what `Extract this heading...` would have taken — but they stop there, with no target picker and no note created.

That makes them useful in two quite different ways. On mobile they replace a gesture that often fails: you never touch a selection handle. On desktop they are a fast way to grab a structural range that no keyboard shortcut covers, so you can cut, delete, comment out, or hand it to any other command.

## The five

- `Select this heading`
  - the heading line, its body, and everything nested under it. Works from anywhere inside the section, not just from the `#` line.
- `Select this heading's content`
  - the same section WITHOUT its heading line. Use it when the title stays and only the body is being replaced.
- `Select before cursor`
  - everything from the top of the note down to the cursor.
- `Select after cursor`
  - everything from the cursor down to the end of the note.
- `Select between horizontal rules`
  - the block between the horizontal rules nearest the cursor. The rules themselves stay outside the selection.

None of them ends in `...`, and that is deliberate: in this plugin the three dots mark a command that opens a dialog, and these open nothing.

## Try it

1. Put the cursor anywhere inside `A section to select` below — on its heading, or in its body.
2. Run `Select this heading`. The heading and both of its paragraphs are selected.
3. Now run `Select this heading's content`. The same range, minus the `## A section to select` line.
4. With the cursor still there, run `Select between horizontal rules` and watch the selection change to the rule-bounded block instead.

## A section to select

This paragraph and the one below it make up the body of the section. `Select this heading` takes them and the heading line; `Select this heading's content` takes them alone.

A heading with nothing under it has no content, so `Select this heading's content` is not offered there at all.

---

## Between the rules

This block sits between two horizontal rules, so `Select between horizontal rules` selects it when the cursor is here. The `---` lines above and below stay put.

---

## Good to know

- A command you cannot use is not offered
  - `Select before cursor` disappears with the cursor at the very top of the note, `Select after cursor` at the very bottom, and `Select between horizontal rules` in a note with no rules. On a phone, where filtering the command palette means typing, a list without the useless entries is worth having.
- They never write anything
  - so the `Include/exclude` → `Paths` setting, which decides what may be merged or split, does not hide them. Their own `Select commands` paths pair does, and nothing else.
- They work with a selection already active
  - unlike `Extract this heading...`, which hides itself in the editor menu when you have selected something. Re-selecting over a live selection is the whole point here.

Once you have the selection, the rest of the plugin is waiting for it: [05 Extract selection](<../02 Extract/05 Extract selection.md>), [25 Smart cut and paste](<../07 Smart cut and paste/25 Smart cut and paste.md>) or [19 Swap selections](<../05 Swap/19 Swap selections.md>).
