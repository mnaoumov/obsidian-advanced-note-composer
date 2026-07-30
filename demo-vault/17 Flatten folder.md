[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Flatten folder

Promote children of a folder up one level, so they become siblings of that folder. Subfolders are
moved whole (their internal structure is kept, not collapsed). Links are updated automatically, and
any name collision with an existing sibling is de-duplicated.

## Try it

1. Open [[Note one]] inside the `Flatten example` folder.
2. Run `Flatten folder...`.
3. Read the confirmation dialog: it lists every item that is about to move, and shows the
   de-duplicated name (`a.md → a 1.md`) for anything that would collide with an existing sibling.
   Choose `Flatten`.
4. Watch [[Note one]], [[Note two]], and the `Nested` subfolder pop up one level (into the vault
   root), while `Flatten example` is left behind, now empty.

The link from [[Note one]] to [[Note two]] keeps resolving after the move, and `Nested` travels
with its own note inside it.

The dialog is there because this command has no picker to review before it acts. Tick
`Don't ask again` in it, or turn off **Should ask before flattening a folder** under
`Move/flatten folders` in the settings, to flatten straight away.

## Try the other modes

**Flatten mode** (also under `Move/flatten folders`) decides *what* gets promoted. Pick one below,
then undo the flatten and run it again to compare. Manual equivalent: change **Flatten mode** in
**Settings → Advanced Note Composer**.

```code-button
---
caption: All children (default), then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { flattenMode: 'AllChildren' });
```

```code-button
---
caption: Child folders only, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { flattenMode: 'ChildFoldersOnly' });
```

```code-button
---
caption: All folders recursively, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { flattenMode: 'AllFoldersRecursively' });
```

- `All children` - what the walkthrough above describes: everything moves, and `Flatten example` is
  left empty.
- `Child folders only` - only `Nested` moves. [[Note one]] and [[Note two]] stay put, so
  `Flatten example` survives intact. If those notes had an attachment folder inside `Flatten
  example`, it would stay too - it holds the attachments of notes that are not going anywhere.
- `All folders recursively` - `Nested` **and** its own `Deeper` subfolder both land beside
  `Flatten example`, so a whole tree of folders collapses into one row of siblings. Each keeps the
  notes directly inside it: [[Deep note]] stays in `Nested`, [[Deepest note]] in `Deeper`.
