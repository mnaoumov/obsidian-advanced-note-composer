# Name first, then the folder

A split that **creates** a note has two questions to answer: what it is called, and where it goes. The
picker asks them in that order, and it will not let you skip the first one.

## The name is required

While the switch reads `Create` and the box is empty, nothing can be chosen — not `Enter`, not a click on
a row in the list — and a line under the box says so. Before, an empty box was accepted: it became a note
called `Untitled`, wherever Obsidian's `Default location for new notes` happens to point.

A box holding only spaces counts as empty, for the same reason.

`Merge` is not restricted this way. There the box is a **search** for a note that already exists, and an
empty search simply has not narrowed the list down yet.

## The note you pick says where

In `Create` the list is not a list of notes to write into — it is your own vault, offered so you can see
what is already named what. Picking one of those notes now decides the **folder** your new note is
created in.

### Try it

There is a note next door called [Placed note nearby](<../Materials/15 Name first, then the folder/Placed note nearby.md>), in a folder of its own.

1. Select the line below the horizontal rule.
2. Run `Extract current selection...`.
3. Type `Placed note` — the list offers `Placed note nearby`, because the name you are typing matches it.
4. Click that row.

You get a new `Placed note` inside that note's folder, and `Placed note nearby` itself is untouched — it
named a destination, it was not merged into.

---

Extract me into the folder of the note you pick.

## Asking for the folder outright

If you would rather be asked every time, turn on **Should ask for the target folder when splitting**
(under `Split/extract` in the settings). Once you confirm the name, a folder picker opens; the folder you
choose there wins over everything else, including a note you highlighted and `Allow only current folder`.

Dismissing that picker is not a cancel — you come back to the picker holding the name you just typed, so
`Escape` there costs you nothing but the folder.

It is off by default, because the common case is an extract whose name is already sitting in the box from
the heading and whose whole interaction is one `Enter`.

## Where a new note goes, in order

| | Wins when |
| --- | --- |
| The folder you were asked for | `Should ask for the target folder when splitting` is on and you chose one |
| The folder of the note you picked | you picked a row in the list |
| The note being split from | `Allow only current folder` (`Alt+4`) is on |
| A path you typed | `Treat title as path` (`Alt+2`) is on and the name contains `/` |
| Obsidian's `Default location for new notes` | nothing above applies |

`Mod+Enter` always creates from what you typed, so it never picks up a folder from a highlighted row.
