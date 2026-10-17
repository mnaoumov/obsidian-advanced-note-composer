# Split headings automatically

Heading-driven splits normally still ask you something: `Extract this heading...` opens the target picker, and every split asks for confirmation. Turn this on and they just run — each new note named after the heading it came from.

## Try it

1. Turn on **Should split headings automatically** in the plugin settings (under `Split/extract`).
2. Also turn on **Should split into folder** to get one folder per heading.
3. Open [Greek letters](<../Materials/12 Split headings automatically/Greek letters.md>), put the cursor anywhere inside its `Beta` section and run `Extract this heading...`. It splits immediately — no picker, no confirmation — into `Beta/Beta.md`.
4. Put the cursor in any remaining `##` section and run `Split note by headings - H2` instead: every `##` section left in that note is extracted in one go, each into its own heading-named folder — still without a single prompt.

The buttons below do each step in turn. The last one puts **Greek letters** back, deletes the folders the splits created, and turns both settings off again.

```code-button
---
caption: Turn on split headings automatically and split into folder
---
await require('/demoSetup.ts').changeSettings(app, { shouldSplitHeadingsAutomatically: true, shouldSplitIntoFolder: true });
```

```code-button
---
caption: Extract the Beta heading
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'extract-this-heading', cursorBefore: 'The second section.', notePath: 'Materials/12 Split headings automatically/Greek letters.md' });
```

```code-button
---
caption: Split the rest by H2
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'split-note-by-headings-h2', cursorBefore: 'The first section.', notePath: 'Materials/12 Split headings automatically/Greek letters.md' });
```

```code-button
---
caption: Put Greek letters back and turn both settings off
---
const demo = require('/demoSetup.ts');
await demo.changeSettings(app, { shouldSplitHeadingsAutomatically: false, shouldSplitIntoFolder: false });
await demo.resetDemo(app, ['Materials/12 Split headings automatically', 'Alpha', 'Alpha.md', 'Beta', 'Beta.md', 'Gamma', 'Gamma.md']);
```

It covers `Split note by headings - H1` through `H6`, their `content` variants, and `Extract this heading...`.

Leave the setting off (the default) and these commands keep asking, as configured by **Should ask before splitting**. That setting still governs ordinary splits, where you pick the target yourself, whichever way this one is set.
