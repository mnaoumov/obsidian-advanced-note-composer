# Selection

Most of this plugin's commands start from a selection, and on a phone that is the step that breaks: dragging the two selection handles onto exactly the right text is fiddly at best and, on some Android keyboards, close to impossible. So the plugin offers commands that make the selection FOR you and then stop — no dialog, no confirmation, nothing moved. What you do with the selection afterwards is up to you: extract it, mark it for a smart cut, swap it, or just delete it.

Two kinds, and they answer different questions. The `Select ...` commands know about markdown, so they can select a heading's whole section or the block between two horizontal rules in one action. The `Selection anchor` commands know nothing about markdown but can select ANYTHING: mark one end, move the cursor, mark the other.

| Note | What it covers |
| --- | --- |
| [38 Select ranges](<./38 Select ranges.md>) | The five one-action selects: a heading, its content, before or after the cursor, between horizontal rules |
| [39 Selection anchor](<./39 Selection anchor.md>) | Marking two ends to select an arbitrary range, and cancelling one you started |

On mobile, put these on the toolbar above the keyboard — Obsidian's own `Settings` → `Mobile` → `Manage toolbar options` — and the whole flow becomes taps.
