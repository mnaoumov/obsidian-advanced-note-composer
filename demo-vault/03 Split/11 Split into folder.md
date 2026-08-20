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
Links and footnotes are fixed exactly as for an ordinary split — the folder changes where the note
lands, nothing else about the operation.

## Predefine the note name

By default the note is named after its folder. **Split into folder note name** (right below the toggle)
overrides that, so every folder split produces the same note name.

1. With **Should split into folder** still on, set **Split into folder note name** to `Overview`.
2. Extract another selection into a new note, e.g. `My second extract`.
3. It now lands at `My second extract/Overview.md` — the folder still carries the name you typed, the
   note inside it is always `Overview`.

The name you typed is not lost: it is added as an alias and a frontmatter `title`, so
`[[My second extract]]` still resolves.

The field takes the same `{{...}}` tokens as the templates (except `{{content}}`, which is meaningless
in a file name), resolved against the new note before it moves — so `{{newTitle}}` is the folder name
and `{{newTitle}} index` yields `My second extract/My second extract index.md`. Leave the field empty
to go back to naming the note after its folder.

The folder tokens name the folder **being created**, so `{{index:00}} {{safeFolderName}}` inside a
folder called `7. Beta` gives `7. Beta/07 Beta.md`, while `{{parentFolder}}` is resolved before the
note moves and so still names the folder *above* the new one. The whole field does nothing while
**Should split into folder** is off.

## Naming the folder in your template

The folder tokens of `Create folder with notes...` work in **Split template** too, naming the folder
the split just created — see [31 Templates](<../09 Titles, links and frontmatter/31 Templates.md>). The button below sets a split template that stamps that
folder's name and its number onto every extracted note; extract into a note named `3. Design` and the
produced note carries `title: 3. Design`, `aliases: [Design]` and `part: 3`.

```code-button
---
caption: Set a folder-aware split template
---
await require('/demoSetup.ts').changeSettings(app, { splitTemplate: '---\ntitle: {{folderName}}\naliases: [{{safeFolderName}}]\npart: {{index}}\n---\n\n{{content}}' });
```

```code-button
---
caption: Restore the default (empty) split template
---
await require('/demoSetup.ts').changeSettings(app, { splitTemplate: '' });
```

---

Select me and extract me into a brand-new note. With **Should split into folder** on, a new folder is
created to hold the extracted note.
