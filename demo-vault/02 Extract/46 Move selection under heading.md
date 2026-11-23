# Move selection under heading

`Move selection under heading...` files a selection under a heading of another note, or of the same note, without opening that note. It asks two questions: which note, then which heading in it.

- `Enter` on the heading puts the selection at the **end** of that heading's own text, just before the next heading.
- `Shift+Enter`, or the `Insert at top` checkbox on a touch screen, puts it **right under** the heading line.

A heading's text here ends at the next heading of any level, so the selection never lands under one of its sub-headings.

While a selection is marked with `Smart cut & paste: Mark selection to move`, `Smart cut & paste: Move marked selection under heading...` does the same for the marked selection, from whatever note is open.

## Try it

1. Open [Inbox](<../Materials/46 Move under heading/Inbox.md>) and select the line about the venue.
2. Run `Move selection under heading...`, choose [Projects](<../Materials/46 Move under heading/Projects.md>), then the `Conference` heading, and press `Enter`.
3. The line now sits under `Conference` in Projects, after `Book the keynote speaker`, and Inbox holds a link to `Projects#Conference` in its place. Projects was not opened.

The first button does step 1 and runs the command, so the note picker is waiting. The second puts both notes back.

```code-button
---
caption: Select the venue line and run the command
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'move-selection-under-heading', notePath: 'Materials/46 Move under heading/Inbox.md', selection: 'Ask the venue for a quote on the second hall.' });
```

```code-button
---
caption: Put both notes back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/46 Move under heading/Inbox.md', 'Materials/46 Move under heading/Projects.md']);
```

## Good to know

- Everything an extract into an existing note does applies here too: the `Split template`, footnotes, attachments, and the residual chosen by [07 Text after extraction](<./07 Text after extraction.md>), which links the heading rather than the top of the note.
- The note is opened afterwards only when `Should open target note after split` is on.
- Moving within the same note leaves nothing behind, as a same-note extract does. A heading inside the selection itself is refused.
- Daily-note destinations, which `Text Mover` also offers, are not part of this command.
