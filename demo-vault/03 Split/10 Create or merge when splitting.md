# Create or merge when splitting

Every split or extract does one of two things with the target you pick: it **creates** a new note, or it **merges** the extracted content into a note that already exists. The switch at the top of the picker says which — before, you had to infer it from what you happened to type.

## Try it

There is a note next door called [Split merge target](<../Materials/10 Create or merge when splitting/Split merge target.md>). It already exists, which is what makes the two modes tell different stories about the same typed name.

1. Select the line below the horizontal rule.
2. Run `Extract current selection...`.
3. The switch reads `Create`. Type `Split merge target` and press `Enter` — you get a **second**, numbered note beside the existing one. Undo it (`Ctrl+Z`) and come back.
4. Run the command again, flip the switch to `Merge` (or press `Alt+M`), type `Split merge target`, pick it from the list and press `Enter`. This time the text lands **inside** the existing note.

---

Extract me twice — once in each mode — and watch the same name mean two different things.

## What each mode offers

| | `Create` | `Merge` |
| --- | --- | --- |
| The list | your notes, as path autocomplete — `Tab` completes a folder, `Enter` always creates | only notes that exist; nothing that would create one |
| `Enter to create` row | yes | no |
| Unresolved links | offered, per `Allow split into unresolved path` | never (they are notes that do not exist yet) |
| The current note | not offered | offered, per `Should offer the current note when splitting` |

That last row is worth knowing: extracting into the note you are already in — the `Enter` / `Shift+Enter` same-note move of [05 Extract selection](<../02 Extract/05 Extract selection.md>) — is a merge into an existing note, so it lives in `Merge`.

## Keys and defaults

- `Alt+M` flips the switch without reaching for the mouse.
- `Mod+Enter` still forces a creation from whatever you typed — and moves the switch to `Create` as it does so, so the switch is never telling you one thing while the picker does another.
- **Default split target mode** (under `Split/extract` in the settings) decides which mode the picker opens in. It defaults to `Create`.
- **Should remember the last split target mode** (right below it, off by default) hands that setting to the picker: choose a target in `Merge` and the next extract opens in `Merge`. The two flows that show no switch — a heading-driven split that never opens the picker, and `Create empty note at cursor...`, which has nothing to merge — save nothing, so neither can reset your mode from a screen you never saw.
- `Treat title as path` (`Alt+2`) and `Allow split into unresolved path` (`Alt+6`) only mean something while a note is being created, so `Merge` greys them out and gives your choices back on the way out.
- Turning **[Should show per-operation option overrides](<../10 UI/36 Settings.md>)** off removes the switch **and** `Alt+M`, so every split opens in your `Default split target mode` and stays there. Nothing hidden keeps working behind the control that is gone.

## The box is remembered per mode

The two modes ask for different things — a name to invent, or a note to find — so each keeps its own text.

- Extracting a heading seeds the box with the heading name. That name belongs to `Create`: flip to `Merge` and the box is **empty**, ready for you to search, instead of holding a name you have to erase first.
- Flip back and the heading name is there again — and so is anything you typed over it, because each mode gives back what **you** last left in it rather than re-seeding on top of your own typing.
- `Mod+Enter` is the exception, and deliberately so: it says "what I just typed is a new note's name", so that text travels with the switch into `Create` instead of being swapped out.
- If your `Default split target mode` is `Merge`, the picker opens empty for the same reason.
