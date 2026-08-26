# Text after extraction

When you extract a selection, something can be left in its place: a **link** to the new note, an **embed** of it, or **nothing**.

## Try it

1. Pick one of the three buttons below to set the mode (or set **Text after extraction** in **Settings → Advanced Note Composer** manually).
2. Select the paragraph under the rule and run `Extract current selection...` into a new note.
3. Look at what is left here - a link, an embed, or an empty gap.

```code-button
---
caption: Leave a link
---
await require('/demoSetup.ts').changeSettings(app, { textAfterExtractionMode: 'link' });
```

```code-button
---
caption: Leave an embed
---
await require('/demoSetup.ts').changeSettings(app, { textAfterExtractionMode: 'embed' });
```

```code-button
---
caption: Leave nothing
---
await require('/demoSetup.ts').changeSettings(app, { textAfterExtractionMode: 'none' });
```

---

Extract me into a new note and see what replaces me, based on the mode you chose above.

## Moving within the same note

A link or an embed pointing at the note you are already in says nothing, so a **same-note** move ignores the setting and simply removes the moved text. Turn on **Apply text after extraction to the same file** to apply it anyway, or override it for one move with `Move marked selection here (advanced)...` — see [25 Smart cut and paste](<../07 Smart cut and paste/25 Smart cut and paste.md>).
