[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Split heading recursively

[[27 Split headings recursively]] restructures the *whole* note. This command does the same thing to
**one** heading — the one your cursor is in — and leaves every other heading exactly where it is. Use it
when a single section has outgrown its note and the rest should stay put.

## Try it

1. Put the cursor anywhere in the `Shopping` section below. Its heading line works, and so does any line
   of its body — the command takes the heading you are *inside*.
2. Run `Split heading recursively...`, either from the right-click menu or from the command palette.
3. The dialog names the heading and lists only the notes that heading will produce. Press `Split`.
4. Look in the file explorer:

```text
Shopping/
  Shopping.md
  Pantry/
    Pantry.md
```

Now scroll back here. `Cooking` and `Serving` are untouched, bodies and all — only `Shopping` left,
replaced by a link down into its new tree. That is the whole difference from the recursive split of the
whole note, which would have turned all three into folders.

## Which heading it takes

The heading **enclosing the cursor**, exactly like `Extract this heading...` — so you never have to
click precisely on the `#` line. Right-clicking inside a section and picking the command from the menu
is the quickest way to say "this one".

With text selected the command steps out of the right-click menu (`Extract current selection...` is
what you want there); it stays in the command palette either way.

Try it on `Cooking` too. It has no sub-headings, so the command produces a single `Cooking/Cooking.md` —
the same thing the recursive split does when it reaches the bottom of a tree.

## Everything else matches the whole-note command

- The folder tree is built whether or not `Should split into folder` is on.
- Every note it creates is wrapped in your `Split template`.
- It asks once, up front, as `Should ask before splitting` says — and `Change target` (or `Alt+C`) in
  that dialog picks the folder the produced tree is rooted in.
- `Should split recursively into the default new note folder` moves that root into Obsidian's own
  `Default location for new notes`, and only the root: what nests below it still nests.

## Shopping

What to buy before starting.

### Pantry

Flour, olive oil, tinned tomatoes.

## Cooking

Twenty minutes, one pan.

## Serving

Plates warmed, bread on the side.
