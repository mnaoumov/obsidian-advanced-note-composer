[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer#move-selection-to-another-note-smart-cut--paste)

# Text after extraction

When you extract a selection, something can be left in its place: a **link** to the new
note, an **embed** of it, or **nothing**.

## Try it

1. Pick one of the three buttons below to set the mode (or set **Text after extraction** in
   **Settings → Advanced Note Composer** manually).
2. Select the paragraph under the rule and run `Extract current selection...` into a new note.
3. Look at what is left here - a link, an embed, or an empty gap.

The buttons need the [[16 CodeScript Toolkit prerequisite]].

```code-button
---
caption: Leave a link, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { textAfterExtractionMode: 'link' });
```

```code-button
---
caption: Leave an embed, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { textAfterExtractionMode: 'embed' });
```

```code-button
---
caption: Leave nothing, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { textAfterExtractionMode: 'none' });
```

---

Extract me into a new note and see what replaces me, based on the mode you chose above.
