# Relative links

When you extract or merge a note that contains links **relative to its folder**, the core Note composer leaves them pointing at the wrong place. `Advanced Note Composer` rewrites them so they keep resolving.

## Try it

1. Open [Note with relative links](<../Materials/27 Relative links/Relative links/Note with relative links.md>) in the `Relative links` folder.
2. Select its two bullet links.
3. Run `Extract current selection...` and extract them into a **new note at the vault root**.
4. Open the new note and confirm both links still resolve to the sibling and the deep note.

The first button below does steps 1 and 2 and runs the command, so the picker of step 3 is waiting for a name. The second puts the two links back in **Note with relative links**; the note you created keeps its copy.

```code-button
---
caption: Extract the two relative links
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'extract-current-selection', notePath: 'Materials/27 Relative links/Relative links/Note with relative links.md', selection: '- A sibling note: [Sibling note](<Sibling note.md>)\n- A note in a subfolder: [Deep note](<Subfolder/Deep note.md>)' });
```

```code-button
---
caption: Put the two links back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/27 Relative links']);
```

Without this plugin, the extracted links would break because they were written relative to the `Relative links` folder, not the vault root.
