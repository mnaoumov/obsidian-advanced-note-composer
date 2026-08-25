# Command menu placement

Obsidian has **two** context menus over an open note, and a right-click only ever raises one of them.

- Right-click **the text** and you get the editor menu — `Cut`, `Copy`, `Format`, and every Advanced Note
  Composer command that applies.
- Right-click **the empty space beside the text**, the margin `Readable line length` leaves, and you get a
  much smaller menu: `Readable line length`, `Line numbers`, `Inline title`. The line-number gutter raises
  that same menu.

The first menu gets long. This plugin alone can put nine items in it, and they sit under everything
Obsidian already puts there. So each category of commands picks which menu it appears in.

## Try it

1. Turn on `Settings -> Editor -> Readable line length`, so there is a margin to right-click.
2. Right-click this note's text. `Split note by headings recursively...` is in the menu, near the bottom.
3. Open the plugin settings, go to `Include/exclude`, find the `Split/extract commands` group, and set
   `Split/extract command menu placement` to `Readable line length margin`.
4. Right-click the text again — the split and extract commands are gone.
5. Right-click the empty margin to the left or right of the text. There they are, under Obsidian's three
   view toggles.

The line-number gutter works the same way, so you do not have to aim at empty space if the window is
narrow.

## The four choices

| Placement | Right-click on the text | Right-click on the margin |
| --- | --- | --- |
| `Editor menu` | shown | — |
| `Readable line length margin` | — | shown |
| `Both` | shown | shown |
| `Neither` | — | — |

`Editor menu` is the default, so nothing moves until you move it.

`Neither` is not the same as listing a path in `Split/extract command exclude paths`. Excluding a path
takes the commands away entirely; `Neither` only takes them out of the context menus. They still run from
the command palette, and from any hotkey you assigned.

## Which categories can be placed

Six of the eight:

- `Split/extract`
- `Create`
- `Smart cut & paste`
- `Swap`
- `Rename`
- `Reorder`

`Merge` and `Move/flatten` have no placement row. Every command in them is invoked from a file or folder
in the file explorer, not from inside a note, so there is no editor menu for them to be placed in.

## What placement does not change

- **The gates each command already has.** `Split note by headings recursively...` still hides itself while
  you have a selection (see
  [13 Split headings recursively](<../03 Split/13 Split headings recursively.md>)) — on the margin as well
  as on the text. Placement decides *which menu*, never *whether the command applies*.
- **Reading mode.** Obsidian raises the margin menu over a note you are reading too, but these commands
  edit the note, so they are only ever offered while you are editing.
- **The command palette and your hotkeys.** Those are never touched by this setting.

## Where the keys live

`splitCommandMenuPlacement` and its five siblings — see
[36 Settings](<./36 Settings.md>).
