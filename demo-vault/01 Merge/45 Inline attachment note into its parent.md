# Inline attachment note into its parent

The reverse of [Extract attachment into its own note](<../02 Extract/44 Extract attachment into its own note.md>). An attachment can be owned two ways: in the **block model** it is embedded on one line of its parent note, and other notes link `[[parent#^block]]`; in the **attachment-note model** it has a note of its own, and everything links that note.

`Inline attachment note into its parent` moves one attachment from the attachment-note model back to the block model. Run it on an attachment note, a note whose body holds exactly one link or embed, to an attachment:

1. The parent is the note that links the attachment note. When several do, the one linking it from a list item is taken; otherwise you pick one.
2. The attachment moves into the parent's attachment folder, through the same resolution `Custom Attachment Location` answers when it is installed.
3. The parent's link to the note becomes the embed of the attachment, carrying the note's first alias as link text (`![[scan.png|Taxi to the airport]]`).
4. Every other link to the note, `[[Taxi receipt|text]]`, now links the parent's line, `[[Receipts#^block|text]]`, with its display text kept. The line gets a block id only when something links it, and keeps the one it already has.
5. The attachment note goes to the trash.

## Try it

1. Open [Taxi receipt](<../Materials/45 Inline attachment/Taxi receipt.md>).
2. Run `Inline attachment note into its parent`, from the command palette or the file explorer's menu.
3. Open [Receipts](<../Materials/45 Inline attachment/Receipts.md>): it now embeds the scan as `Taxi to the airport`, and [Expenses](<../Materials/45 Inline attachment/Expenses.md>) links that line.

The first button does steps 1 and 2. The second puts every note back.

```code-button
---
caption: Inline the taxi receipt note
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'inline-attachment-note-into-parent', notePath: 'Materials/45 Inline attachment/Taxi receipt.md', shouldWaitUntilDone: true });
```

```code-button
---
caption: Put the attachment note back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/45 Inline attachment', '_assets/attachments/taxi-receipt-scan.png'], ['Materials/45 Inline attachment']);
```

## Good to know

- The command is offered only on an attachment note that some other note links from its body.
- It refuses an attachment referenced from anywhere but its attachment note, as the forward command refuses one referenced from anywhere but its parent.
- When the note holds more than one alias, other properties or other text, a dialog lists what would be dropped before anything changes.
- The whole operation is one transaction. A cancel or an error puts every note and the attachment back.
