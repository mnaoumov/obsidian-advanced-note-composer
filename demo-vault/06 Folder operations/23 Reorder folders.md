# Reorder folders

Put a folder's contents in the order **you** choose, and renumber them to match — the number in each
folder's name and the one inside its folder note's `title` property.

Two commands, differing only in which row they reorder:

- `Reorder sibling folders...`
  - reorders the folder you right-clicked **among its siblings** — every child folder of its parent.
    This is also the only way to reorder your **top-level** folders, since the vault root has no
    right-click menu of its own: right-click any folder at the root and all of them are offered.
- `Reorder child folders...`
  - reorders what is **inside** the folder you right-clicked. From the command palette it uses your
    vault's `Files & Links > Default location for new notes`, exactly as
    [22 Create folder with notes](<../06 Folder operations/22 Create folder with notes.md>) does.

## Try it

1. Right-click the `Reorder example` folder and choose `Reorder child folders...`.
2. The dialog lists `Alpha`, `Beta` and `Gamma` — **without** their numbers — each badged with the
   number it will get.
3. Drag `Alpha` to the bottom, or press its down arrow twice. The badges renumber as you go: the
   dialog is the preview, so there is no second confirmation.
4. Click **Reorder**.

Every folder is renumbered, not only the one you moved: `1. Beta`, `2. Gamma`, `3. Alpha`. Open any of
their `!` notes and the `title` property has followed the folder — while `aliases`, which holds the name
without the number, is untouched.

Renumbering the **whole sequence** from 1 is what keeps it contiguous, and a folder that never had a
number simply gains one. It all happens in one reversible, resource-locked transaction: cancel it, or
change something externally, and the names and properties roll back together.

Items whose path is ignored by your
[include/exclude paths](<../08 Include and exclude/26 Block commands on excluded paths.md>) are left out of the dialog
entirely, so a reorder neither renames nor renumbers around them.

## Include files

Tick **Include files** in the dialog and the folder's own notes join the list as a second group. Folders
and notes are **two independent sequences**, each numbered from 1, because the file explorer always sorts
folders above files — one merged numbering could never be shown in the order it claims.

[Loose note](<../Materials/23 Reorder folders/Reorder example/Loose note.md>) in `Reorder example` is there to try it on. The box starts from **Should include files when
reordering by default**, which is off, so reordering subfolders never silently renames the notes beside
them.

## The numbering is yours

Nothing about the `1.` prefix shape is hard-coded — **Reordered folder name template** decides it:

- `{{index}} {{safeFolderName}}` drops the period, `{{index}}-{{safeFolderName}}` changes it;
- `{{index:000}}` zero-pads, giving `007. Notes`;
- `{{safeFolderName}} ({{index}})` puts the number at the end.

Reading an existing number back uses the same template, so what writes the names and what recognizes
them can never disagree. **Reordered file name template** is the same thing for notes, kept separate so
folders and notes can be numbered differently — and a note's extension is never touched. Both
templates must contain `{{index}}` and `{{safeFolderName}}` (`{{safeName}}` for a note): without the
first there is no number to rewrite, and without the second renumbering would drop the name.

They are also deliberately separate from **Create folder name template**, so creating and reordering
can follow different schemes.

## What a reorder writes into the folder note

- **Folder note title template** (default `{{folderName}}`, under `Folder note`)
  - the `title` a reorder writes. `{{folderName}}` is the new name **with** its number,
    `{{safeFolderName}}` the same name without it. Leave it empty to leave the property alone. It is
    shared with [24 Rename folder](<../06 Folder operations/24 Rename folder.md>), because both write the same property of
    the same note.
- **Reordered file title template**
  - the same thing for notes, and **empty by default** — so a reordered note is renamed and nothing
    else until you fill it in.

A reorder writes only `title`; `aliases` and everything else are left as they are.

## Which note is the folder note

`Reorder example` uses `!` as its folder-note name, which is what **Folder note name template** says.
Set **Folder note location** to `Auto` — the default — and the answer comes from the
`Folder notes` plugin instead, whenever you have it installed.

A folder note named after its folder (`{{folderName}}`) is renamed along with its folder, since
`1. Alpha/1. Alpha.md` would otherwise stop being a folder note the moment the folder is renumbered. A
fixed name like `!` needs no rename and gets none.
