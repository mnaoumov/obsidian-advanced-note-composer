# Templates

Merged and split content can be wrapped in a **template**. Templates support tokens that are
filled in at merge/split time.

## Tokens

- `{{content}}` - the extracted or merged text (**required** in every non-empty template).
- `{{fromTitle}}` / `{{fromPath}}` - the source note's title / path.
- `{{newTitle}}` / `{{newPath}}` - the destination note's title / path.
- `{{fromParentFolder}}` / `{{newParentFolder}}` - the source / destination note's parent folder name.
  `{{parentFolder}}` is an alias for `{{newParentFolder}}`.
- `{{date:FORMAT}}` / `{{time:FORMAT}}` - the current date / time, formatted with a
  [moment.js](https://momentjs.com/docs/#/displaying/format/) format string.

### Folder tokens

The tokens of `Create folder with notes...` work here too, naming **the folder the new note ends up
in** - which with **Should split into folder** on is the folder the split just created:

- `{{folderName}}` / `{{folderPath}}` - that folder's name / full path.
- `{{safeFolderName}}` - its name without its number, and `{{index}}` - the number itself (empty when
  it has none; `{{index:000}}` zero-pads). Both read the number back through
  **Reordered folder name template**, so however you write your numbering, every command agrees.
- `{{parentFolderPath}}` - the same folder's path, so `{{parentFolder}}` / `{{parentFolderPath}}` name
  the same folder.

`{{rawFolderName}}` and `{{file}}` are **not** available here: a split has no folder-name prompt, and
it writes one note rather than several. See [29 Create folder with notes](<./29 Create folder with notes.md>) for the command those two
belong to, and [25 Split into folder](<./25 Split into folder.md>) for the setting that gives a split a folder of its own.

There are three base template settings: **Merge template**, **Split template**, and
**Smart cut & paste template**. Empty templates fall back up the chain:
smart cut and paste falls back to split, which falls back to merge.

Smart cut and paste can also be templated **per direction** - see
[09 Smart cut and paste](<./09 Smart cut and paste.md>).

## Try it

The button below sets a **Merge template** that stamps a heading and date onto merged
content. Manual equivalent: paste the same
template into **Merge template** in **Settings → Advanced Note Composer**. Then run
`Merge current file with another file...` from any note and inspect the result.

```code-button
---
caption: Set a dated merge template, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { mergeTemplate: '\n\n## Merged from {{fromTitle}} ({{date:YYYY-MM-DD}})\n\n{{content}}' });
```

To restore the default, set the template back to `\n\n{{content}}`.

```code-button
---
caption: Restore the default merge template, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { mergeTemplate: '\n\n{{content}}' });
```
