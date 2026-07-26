[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Swap folder

Exchange two folders - either their entire structures or just the top-level notes.

## Try it

1. Open [[Note A]] inside `Swap examples/Folder A`.
2. Run `Swap folder with...`.
3. Pick `Folder B`.
4. A confirmation dialog asks you to confirm the swap - click **Swap** (or **Change target** to pick a
   different folder, or **Cancel** to abort). It is controlled by the **Should ask before swapping**
   setting (on by default) - the same setting used by `Swap file with...`.

By default the **entire folder structure** is swapped. The block below turns that off so
only top-level notes swap. Manual
equivalent: toggle **Should swap entire folder structure** in
**Settings → Advanced Note Composer**.

```code-button
---
caption: Swap top-level notes only, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldSwapEntireFolderStructureByDefault: false });
```
