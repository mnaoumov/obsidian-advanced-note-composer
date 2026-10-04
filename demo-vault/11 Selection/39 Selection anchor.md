# Selection anchor

The commands in [38 Select ranges](<./38 Select ranges.md>) select shapes markdown knows about. This one selects anything at all: mark where the selection starts, move the cursor to where it ends, mark again.

- `Selection anchor: Start selection`
  - drops an anchor at the cursor. A thin coloured marker appears there so you can see it is armed.
- `Selection anchor: End selection`
  - selects from the anchor to wherever the cursor is now, and removes the anchor. With no anchor set, it selects from where your most recent selection began.
- `Selection anchor: Cancel selection`
  - removes the anchor without selecting anything.

`Cancel selection` is only offered while an anchor is set, and `End selection` only while there is an anchor or an earlier selection to start from, so they stay out of your way the rest of the time.

Why two commands rather than one that toggles: on the mobile toolbar two labelled buttons beat one whose meaning depends on state you cannot see. And placing a cursor by tapping is reliable on a phone — it is dragging the selection handles that is not — so tap, `Start`, tap the far end, `End` is a selection made entirely out of the gesture that works.

## Try it

1. Put the cursor before the word `FROM` in the paragraph below.
2. Run `Selection anchor: Start selection`. A marker appears at the cursor.
3. Put the cursor after the word `TO`, further down the same paragraph.
4. Run `Selection anchor: End selection`. Everything between the two points is selected.

The anchor runs FROM about here, through this sentence and the next one, and on down TO about there — a range that no single "select the heading" style command could have described, which is exactly the case this feature exists for.

Now try it in the other direction: anchor at the END of that paragraph and end the selection at its start. The order you mark the two points in does not matter.

## It survives editing

The interesting part. You are meant to keep working between the two commands, so the anchor moves with the text rather than sitting at a fixed position:

1. Run `Selection anchor: Start selection` somewhere in the paragraph above.
2. Go to the TOP of this note and type a few lines of anything.
3. Come back, put the cursor where you want the selection to end, and run `Selection anchor: End selection`.

The selection still starts where you anchored it, not several lines off. Delete the lines you added afterwards.

## Good to know

- `End selection` finishes a selection you already started
  - when a drag stops early, tap where the selection should end and run `End selection`. It selects from where the drag began, even though the tap cleared it. There is no need to run `Start selection` first, or to go back to where you started.
- `Start selection` continues a selection you already started too
  - if text is selected when you run it, the anchor goes where that selection began, not at the cursor. That is useful when you want to move around a while before ending it.
- One anchor exists at a time
  - running `Start selection` again moves it, rather than adding a second.
- The anchor belongs to its note
  - open a different note and it is dropped, so it can never select text you never pointed at. It does not survive a restart either.
- Nothing is locked while an anchor is set
  - unlike a smart-cut mark, which locks its source note because the marked text must not change under it. Here the opposite is true: editing in between is expected.
