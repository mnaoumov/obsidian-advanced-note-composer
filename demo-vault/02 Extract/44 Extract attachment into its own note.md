# Extract attachment into its own note

An attachment can be owned two ways. In the **block model** it is embedded on one line of its parent note, that line carries a block id, and other notes link `[[parent#^block]]`. In the **attachment-note model** it has a note of its own, and everything links that note, which can carry `aliases` and properties of its own.

`Extract attachment into its own note` moves one attachment from the first model to the second:

1. A new note is created beside the parent, named after the embed's link text (`March invoice`), or after the file when the embed has none. A size such as `|300` is not a name.
2. The attachment moves into the new note's attachment folder, through the same resolution `Custom Attachment Location` answers when it is installed.
3. The new note embeds the attachment and records the link text in its `aliases`.
4. The parent's embed becomes a link to the new note.
5. Every link to the line's block, `[[parent#^block|text]]`, now links the new note with its display text kept, and the block id is dropped, since nothing points at it any more. A plain link to the parent is left alone.

## Try it

1. Open [Invoices](<../Materials/44 Extract attachment/Invoices.md>) and put the cursor on the line with the March invoice scan.
2. Run `Extract attachment into its own note`, from the command palette or the editor menu.
3. Open [Payments](<../Materials/44 Extract attachment/Payments.md>): its link to the March invoice now points at the new `March invoice` note, and still reads `the March invoice`.

The first button does steps 1 and 2. The second puts both notes back and deletes the note the extraction created.

```code-button
---
caption: Extract the March invoice scan
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'extract-attachment-into-own-note', cursorBefore: 'March invoice]]', notePath: 'Materials/44 Extract attachment/Invoices.md', shouldWaitUntilDone: true });
```

```code-button
---
caption: Put the attachment back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/44 Extract attachment', '_assets/attachments/march-invoice-scan.png'], ['Materials/44 Extract attachment']);
```

## Good to know

- The command is offered only when the cursor is on an attachment reference, or on a line holding exactly one.
- It refuses an attachment referenced from anywhere else, even a second time from the same note: that reference would be left pointing at a file the new note now owns.
- The whole operation is one transaction. A cancel or an error puts every note and the attachment back.
