# Merge linked notes back

The batch form of merging a note back at its link (see [01 Merge file](<./01 Merge file.md>)). A note split into parts with `Extract …` or `Split note by headings` keeps a link to each part on a line of its own. `Merge linked notes back into this note...` puts all of those parts back in one step:

1. Every note the current note links or embeds on a line of its own goes in place of that link.
2. Its frontmatter is merged into the current note's, as in any merge.
3. The merged note is deleted, and links to it from other notes now point to the current note.

## Try it

1. Open [Trip plan](<../Materials/47 Merge linked notes back/Trip plan.md>).
2. Run `Merge linked notes back into this note...`, from the command palette or the file explorer's menu, and confirm.
3. **Flights** and **Hotel** are now part of **Trip plan**, each where its link was. **Budget** is still a note of its own, because its link sits inside a sentence.

The first button does steps 1 and 2 up to the confirmation. The second puts every note back.

```code-button
---
caption: Merge the linked notes back into Trip plan
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'merge-linked-notes-back', notePath: 'Materials/47 Merge linked notes back/Trip plan.md' });
```

```code-button
---
caption: Put the trip notes back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/47 Merge linked notes back']);
```

## Good to know

- These links are left alone, because there is no single place to put the note:
  1. a link with a heading or block, such as `[Flights](<Flights.md#Return>)`;
  2. a link inside a sentence;
  3. a note linked more than once from the current note.
- A note excluded by the `Merge` path settings is left alone too.
- The confirmation dialog lists every note it will merge, with the line of its link. **Should ask before merging** turns it off, as it does for every merge.
- When a link sits right under a heading the merged note starts with, and `Merge headings` is on, that heading is written once.
- The whole batch is one operation. A cancel or an error puts every note back.
