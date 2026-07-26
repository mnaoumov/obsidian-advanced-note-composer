[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Split into folder

When a split or extract creates a **new** note, optionally wrap it in a brand-new folder named after
the note, so it lands at `<folder>/<note>/<note>.md` instead of `<folder>/<note>.md`. Splitting or
extracting into an **existing** note is unaffected.

## Try it

1. Turn on **Should split into folder** in the plugin settings (under `Split/extract`).
2. Select the paragraph below the horizontal rule.
3. Run `Extract current selection...` and type a new note name, e.g. `My extract`.
4. Confirm. The new note is created at `My extract/My extract.md` — inside a brand-new folder named
   after it — and the link left behind here still resolves.

If a folder with that name already exists, the new folder name is de-duplicated (`My extract 1`, …).

---

Select me and extract me into a brand-new note. With **Should split into folder** on, a new folder is
created to hold the extracted note.
