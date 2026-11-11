# Bulk rename

Select **several notes and folders** in the file explorer and rename them all at once: find and replace (plain text or a regular expression), change the letter case, add a prefix or a suffix, and number them. Links to every renamed item are updated, as with any rename in Obsidian.

## Try it

1. In the file explorer, open the `Bulk rename example` folder.
2. Select [Draft - Meeting](<../Materials/43 Bulk rename/Bulk rename example/Draft - Meeting.md>), [Draft - Plan](<../Materials/43 Bulk rename/Bulk rename example/Draft - Plan.md>) and the `Draft - Archive` folder (Ctrl/Cmd-click, or Shift-click a range).
3. Right-click the selection and choose `Bulk rename...`.
4. Type `Draft -` and a space into **Find**, and leave **Replace with** empty. Then type `{{index:00}}.` and a space into **Prefix**.
5. The preview lists every item with its new name: `01. Archive`, `02. Meeting`, `03. Plan`. Click **Rename**.

The command lives only on the file explorer's menu for a multiple selection, so the first button below opens exactly that menu for the three items — steps 1 to 3 — and you choose `Bulk rename...` from its `Advanced Note Composer` submenu.

```code-button
---
caption: Open the menu for the three Draft items
---
require('/demoSetup.ts').showFileMenu(app, ['Materials/43 Bulk rename/Bulk rename example/Draft - Meeting.md', 'Materials/43 Bulk rename/Bulk rename example/Draft - Plan.md', 'Materials/43 Bulk rename/Bulk rename example/Draft - Archive'], codeButtonContext.buttonEl);
```

Open [Index](<../Materials/43 Bulk rename/Bulk rename example/Index.md>) afterwards: its links now point at the renamed notes, including the ones inside the renamed folder.

```code-button
---
caption: Put the Draft items back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/43 Bulk rename']);
```

## What each field does

The fields apply in this order: **Find** and **Replace with**, then **Change case**, then **Prefix** and **Suffix**.

- **Find** / **Replace with**
  - every match in the name is replaced. With **Use regular expression** on, `$1` in the replacement names the first group, so `(\d{4})-(\d{2})-(\d{2})` replaced with `$3.$2.$1` turns `2024-01-05 Notes` into `05.01.2024 Notes`. **Match case** makes the find case-sensitive.
- **Change case**
  - lower case, UPPER CASE, Title Case or Sentence case.
- **Prefix** / **Suffix**
  - text added before the name and after it. Both take `{{index}}`, the item's number in the batch, and `{{index:00}}` pads it to two digits. **Start number** is the number the first item gets. `{{name}}`, `{{extension}}`, `{{parentFolder}}`, `{{parentFolderPath}}`, `{{date}}` and `{{time}}` work too.

The items are numbered in the order the file explorer lists them: by folder, folders before notes, then by name.

An extension is never renamed, and a folder's name is used whole, so a folder called `v1.2` keeps its dot.

## Nothing runs until every name is usable

The preview marks a name that cannot be used and says why: it is empty, it holds a character a file name cannot (`* " \ / < > : | ? # ^ [ ]`), it starts with a dot or ends with a dot or a space, two items would get the same name, or something outside the selection already has it. **Rename** stays disabled until every marked name is fixed.

A name that only differs in letter case (`note` to `Note`) is fine, and so is renaming items onto each other's names: a swap of two names is done through a temporary name.

## Folders and their notes

A selected folder and a note inside it can be renamed together. A renamed folder's folder note is renamed with it when its name follows the folder's (see [24 Rename folder](<./24 Rename folder.md>) for which note is the folder note), unless that note is in the selection too and gets a name of its own.

## One operation, one undo

The whole batch runs as one reversible operation: if anything fails, or you cancel it from its progress notice, every rename is rolled back. With **Should commit bulk operations** on, it is also one commit, so `Undo a bulk operation...` reverts it.
