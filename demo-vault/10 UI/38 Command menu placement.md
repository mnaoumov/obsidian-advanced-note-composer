# Command menu placement

Obsidian has **two** context menus over an open note, and a right-click only ever raises one of them.

- Right-click **the text** and you get the editor menu — `Cut`, `Copy`, `Format`, and every Advanced Note Composer command that applies.
- Right-click **the empty space beside the text**, the margin `Readable line length` leaves, and you get a much smaller menu: `Readable line length`, `Line numbers`, `Inline title`. The line-number gutter raises that same menu.

The first menu gets long. This plugin alone can put nine items in it, and they sit under everything Obsidian already puts there. So **every command picks which menu it appears in, one command at a time**.

## Try it

1. Turn on `Settings -> Editor -> Readable line length`, so there is a margin to right-click.
2. Right-click this note's text. `Split note by headings recursively...` is in the menu, near the bottom.
3. Open the plugin settings, go to `Command menu placement`, find the `Split/extract command menus` group, and on the `Split note by headings recursively...` row turn `Editor menu` off and `Margin` on.
4. Right-click the text again — that one command is gone, and every other extract and split is still there.
5. Right-click the empty margin to the left or right of the text. There it is, under Obsidian's three view toggles.

The line-number gutter works the same way, so you do not have to aim at empty space if the window is narrow.

## Two toggles per command

Each row has two switches, and they are independent:

| `Editor menu` | `Margin` | Right-click on the text | Right-click on the margin |
| --- | --- | --- | --- |
| on | off | shown | — |
| off | on | — | shown |
| on | on | shown | shown |
| off | off | — | — |

`Editor menu` on, `Margin` off is the default, so nothing moves until you move it.

Both off is not the same as listing a path in `Split/extract command exclude paths`. Excluding a path takes the commands away entirely; both off only takes that one command out of the context menus. It still runs from the command palette, and from any hotkey you assigned.

## Which commands can be placed

Every command that reaches an editor menu at all, grouped on the page by the category it belongs to — `Split/extract`, `Create`, `Smart cut & paste`, `Swap`, `Rename` and `Reorder`.

`Merge` and `Move/flatten` have no rows. Every command in them is invoked from a file or folder in the file explorer, not from inside a note, so there is no editor menu for them to be placed in.

The category headings are there to find a row by, and nothing more: placing one command never moves the rest of its group. That was the whole point of the change — the recursive split could not be demoted to the margin without taking every extract with it.

## What placement does not change

- **The gates each command already has.** `Split note by headings recursively...` still hides itself while you have a selection (see [13 Split headings recursively](<../03 Split/13 Split headings recursively.md>)) — on the margin as well as on the text. Placement decides *which menu*, never *whether the command applies*.
- **Reading mode.** Obsidian raises the margin menu over a note you are reading too, but these commands edit the note, so they are only ever offered while you are editing.
- **The command palette and your hotkeys.** Those are never touched by this setting.

## Where the keys live

`commandMenuPlacements`, one entry per command you have moved — see [36 Settings](<./36 Settings.md>).
