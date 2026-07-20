[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer#move-selection-to-another-note-smart-cut--paste)

# Smart cut and paste

A decoupled, two-step **move**: mark a selection, then drop it exactly where you want -
even in the same note - as a single reversible operation.

## Try it

1. Select the paragraph under the rule below.
2. Run `Smart cut & paste: Mark selection to move`. The selection is highlighted and its
   note is locked so it cannot drift. A persistent notice appears.
3. Click into any note and position the cursor.
4. Run `Smart cut & paste: Move marked selection here` (or use the notice buttons: **Move
   at cursor**, **Move to top**, **Move to bottom**).

Changed your mind? Run `Smart cut & paste: Cancel move`, or click **Cancel move** in the
notice - the mark is discarded and the note unlocked.

---

Mark me, then move me somewhere else. While I am marked, my source note stays locked and I
stay highlighted so you always see what will move.

## Move to top / bottom hotkeys

`Move marked selection to top of file` and `... to bottom of file` ship with **no default
hotkey**. The block below binds `Alt+Shift+Up` to the "move to top" command (needs the
[[CodeScript Toolkit prerequisite]]). Manual equivalent: assign a hotkey in
**Settings → Hotkeys**.

```code-button
---
caption: Bind Alt+Shift+Up to "Move marked selection to top of file"
---
require('/demoSetup.ts').bindHotkey(app, 'advanced-note-composer:move-marked-selection-to-top-of-file', { modifiers: ['Alt', 'Shift'], key: 'ArrowUp' });
```

## Lock every note while marking

By default only the source note is locked. The block below locks **all** notes while a mark
is pending (needs the [[CodeScript Toolkit prerequisite]]). Manual equivalent: toggle
**Should lock all notes when marking selection** in **Settings → Advanced Note Composer**.

```code-button
---
caption: Lock all notes while marking, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldLockAllNotesWhenMarkingSelection: true });
```
