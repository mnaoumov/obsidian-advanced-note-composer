# Settings

Every setting the plugin has, listed by the key it is stored under in `data.json` and grouped by the
page it lives on in `Settings -> Advanced Note Composer`. The notes elsewhere in this vault show these
in action; this one is the reference you scan when you know roughly what you want and need the name of
the thing that does it. To find a setting by its display name instead, see
[35 Finding a setting](<./35 Finding a setting.md>).

## Merge

The `Merge` page groups its settings by **which command reads them**, and so does this list. The two
folder merges are separate operations, so a setting almost always belongs to exactly one of them.

### All merges

- `mergeTemplate`
  - wraps merged content. `{{content}}` is required — see [31 Templates](<../09 Titles, links and frontmatter/31 Templates.md>).
- `shouldAskBeforeMerging`
  - show a confirmation dialog before a merge runs.
- `shouldAlwaysMergeExcludedItems`
  - merge notes on ignored paths too, instead of skipping and reporting them. With it on, an excluded
    note is offered in the destination picker as well.
- `attachmentExtensions`
  - markdown files that are really attachments (default `.excalidraw.md`), never merged as text.
    Splitting and flattening classify them the same way.

### Merge file

- `shouldOpenNoteAfterMerge`
  - open the target note once a file merge lands. Neither folder merge opens what it merges.
- `shouldMoveAttachmentsWhenMergingFile`
  - carry a merged note's own attachments with it.

### Merge folder contents into a single file

- `mergeFolderIntoFileNoteNameTemplate`
  - names the note the merge produces. Empty means name it after the folder.
- `mergeFolderIntoFileLocation`
  - where that note is placed.
- `shouldConvertFoldersToHeadingsWhenMergingFolder`
  - mirror the folder hierarchy as headings in the merged note.
- `shouldMoveAttachmentsWhenMergingFolder`
  - carry the merged notes' attachments into the merged note's attachment folder.
- `emptyFolderBehaviorAfterMergingFolder`
  - what happens to folders the merge empties: delete, delete sub-folders only, delete with empty
    parents, or keep.
- `shouldOpenNoteAfterMergingFolderIntoFile`
  - open the merged note at the very end.

### Merge current folder with another folder

- `shouldIncludeChildFoldersWhenMergingByDefault`
  - offer the merged folder's own subfolders as destinations in the picker.
- `shouldIncludeParentFoldersWhenMergingByDefault`
  - offer the merged folder's own parent folders as destinations in the picker.
- `shouldOpenFirstNoteAfterMergingFolder`
  - open the destination folder's first note once the merge lands.

### Read by merging, but living on another page

- `shouldMergeHeadingsByDefault`
  - merge under a matching heading in the target instead of appending, by default. On
    `Merge/split/extract strategies`, because splitting reads it too.
- `shouldUseSourceTitleWhenTargetHasNoTitle`
  - give the merged note the source's title when the target has none of its own. On the `Frontmatter`
    page with the rest of the property handling.

## Split and extract

- `splitTemplate`
  - wraps content split or extracted into a new note. Falls back to `mergeTemplate`.
- `splitToExistingFileTemplate`
  - which action's template applies when the target already exists, so a split into an existing note
    can be formatted as a merge.
- `defaultSplitTargetMode`
  - whether the picker opens in `Create` or `Merge` — see [10 Create or merge when splitting](<../03 Split/10 Create or merge when splitting.md>).
- `shouldRememberLastSplitTargetMode`
  - let the picker save the mode you chose back into `defaultSplitTargetMode`, so it reopens where you
    left it.
- `shouldAskBeforeSplitting`
  - show a confirmation dialog before a split runs.
- `shouldOfferCurrentNoteWhenSplitting`
  - offer the note you are in as a target, for a same-note extraction.
- `shouldAskForTargetFolderWhenSplitting`
  - once a new note is named, ask which folder to create it in — see [15 Name first, then the folder](<../03 Split/15 Name first, then the folder.md>).
- `shouldAllowSplitIntoUnresolvedPathByDefault`
  - offer unresolved links as split targets.
- `shouldAllowOnlyCurrentFolderByDefault`
  - restrict the target picker to the current folder.
- `shouldIncludeFrontmatterWhenSplittingByDefault`
  - carry the source's properties into the new note.
- `shouldFixFootnotesByDefault`
  - renumber and move footnotes that travel with the extracted text.
- `shouldKeepHeadingsWhenSplittingContent`
  - keep each heading line in the note it produced, rather than dropping it.
- `textAfterExtractionMode`
  - what is left in place of extracted text: a link, an embed, or nothing.
- `shouldApplyTextAfterExtractionToSameFile`
  - apply that to same-note moves too, where a self-link would otherwise be meaningless.
- `shouldExtractFrontmatterSelectionAsProperties`
  - merge a selection made inside the properties block into the target's properties.
- `shouldSplitIntoFolder`
  - put every newly created note in a folder of its own.
- `splitIntoFolderNoteNameTemplate`
  - names the note inside that folder. Empty means name it after the folder.
- `shouldSplitHeadingsAutomatically`
  - run heading splits with no picker and no confirmation.
- `shouldSplitRecursivelyIntoDefaultNewNoteFolder`
  - root a recursive split's folder tree in Obsidian's own default new-note folder.
- `shouldMoveAttachmentsWhenSplitting`
  - carry the attachments the extracted text references into the new note's attachment folder. One the
    text left behind still references stays put.
- `shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit`
  - hand the destination note to Custom Attachment Location once the extract lands, so it collects that
    note's attachments. Covers the shared ones the setting above deliberately leaves behind.
- `shouldOpenTargetNoteAfterSplit`
  - open the note a split produced.

## Swap

- `shouldAskBeforeSwapping`
  - show a confirmation dialog before a swap runs.
- `shouldSwapEntireFolderStructureByDefault`
  - swap folders with everything inside them, rather than their direct contents only.
- `shouldIncludeChildFoldersWhenSwappingByDefault`
  - include subfolders in a folder swap.
- `shouldIncludeParentFoldersWhenSwappingByDefault`
  - mirror parent folders when swapping.

## Smart cut and paste

- `smartCutAndPasteTemplate`
  - wraps text moved at the cursor, and is the fallback for both edge moves.
- `smartCutAndPasteToTopTemplate` / `smartCutAndPasteToBottomTemplate`
  - per-direction overrides. Empty means use the one above.
- `smartCutAndPasteCompletionFeedback`
  - how a finished move shows where the text landed: select it, show a notice, or both.
- `shouldLockAllNotesWhenMarkingSelection`
  - lock every note while a mark is held, not just the source.
- `shouldJumpToMovedContentToTop` / `shouldJumpToMovedContentToBottom`
  - whether the cursor follows text moved to the top or the bottom of the note.
- `shouldShowSmartCutNotice`
  - show the persistent notice while something is marked.
- `shouldShowMoveAtCursorButton` / `shouldShowMoveToTopButton` / `shouldShowMoveToBottomButton`
  - show each of the three move buttons on that notice. `Cancel move` is always shown.
- `shouldShowSplitHeadingRecursivelyButton` / `shouldShowReorderHeadingsButton`
  - show the two extra buttons a *heading* mark adds.

## Frontmatter

- `defaultFrontmatterMergeStrategy`
  - how two notes' properties are reconciled — see [30 Frontmatter merge strategy](<../09 Titles, links and frontmatter/30 Frontmatter merge strategy.md>).

## Title

- `shouldReplaceInvalidTitleCharacters`
  - replace characters a file name cannot hold, instead of refusing the operation.
- `replacement`
  - the string each such character becomes.
- `nameTransformTemplate`
  - your own mapping, applied before anything else — see [28 Invalid titles](<../09 Titles, links and frontmatter/28 Invalid titles.md>).
- `shouldAddInvalidTitleToNoteAlias`
  - keep the original title reachable as an alias.
- `frontmatterTitleMode`
  - when to write the original title into a frontmatter `title` property.
- `shouldTreatTitleAsPathByDefault`
  - turn a title containing `/` into a real folder path.

## Include and exclude

- `includePaths` / `excludePaths`
  - what the plugin may touch at all.
- `commandIncludePaths` / `commandExcludePaths`
  - where its commands are offered — see [26 Block commands on excluded paths](<../08 Include and exclude/26 Block commands on excluded paths.md>).

Each command category then has its own pair, which narrows what the two above already allow. Both empty
means the category follows them exactly.

- `mergeCommandIncludePaths` / `mergeCommandExcludePaths`
  - where the merge commands are offered.
- `splitCommandIncludePaths` / `splitCommandExcludePaths`
  - where the extract and split commands are offered.
- `createCommandIncludePaths` / `createCommandExcludePaths`
  - where the two create-empty-note commands and `Create folder with notes...` are offered.
- `smartCutAndPasteCommandIncludePaths` / `smartCutAndPasteCommandExcludePaths`
  - where marking a selection to move, and the three moves that paste it, are offered.
- `swapCommandIncludePaths` / `swapCommandExcludePaths`
  - where the swap commands are offered.
- `moveAndFlattenCommandIncludePaths` / `moveAndFlattenCommandExcludePaths`
  - where `Move folder...` and the three flatten commands are offered.
- `renameCommandIncludePaths` / `renameCommandExcludePaths`
  - where `Rename folder...` and `Rename heading` are offered.
- `reorderCommandIncludePaths` / `reorderCommandExcludePaths`
  - where the three reorder commands are offered.

## Move and flatten folders

- `shouldAskBeforeFlattening`
  - show a confirmation dialog listing everything a flatten would move.
- `shouldAskBeforeMovingFolder`
  - show a confirmation dialog before a folder move.

## Create folder with notes

- `newFolderNameTemplate`
  - names the created folder. The default numbers it after its siblings.
- `newFolderContentTemplate`
  - declares the notes inside it. Empty means one empty note named after the folder.
- `shouldAskBeforeCreatingFolder`
  - show the confirmation dialog that previews the folder and its notes.
- `shouldShowRenameButtonForCreatedFolder` / `shouldShowRenameButtonForCreatedNotes`
  - show the `Rename` buttons in that dialog.
- `shouldTitleCaseCreatedFolderName`
  - capitalize the folder name you typed, leaving all-caps words alone.
- `shouldOpenNoteAfterCreatingFolder`
  - open the first declared note once the folder is created.
- `shouldRunTemplaterOnDestinationFile`
  - hand each created note to Templater, with the plugin's own tokens already substituted.

## Reorder

- `reorderedFolderNameTemplate` / `reorderedFileNameTemplate`
  - the numbering scheme a reorder writes, and reads existing numbers back through.
- `reorderedFileTitleTemplate`
  - the `title` a reorder writes into a renumbered note. Empty leaves it alone.
- `shouldIncludeFilesWhenReorderingByDefault`
  - tick `Include files` in the reorder dialog by default.

## Folder note

- `folderNoteLocation`
  - which note describes a folder: read it from the Folder notes plugin, say it yourself, or turn the
    idea off — see [24 Rename folder](<../06 Folder operations/24 Rename folder.md>).
- `folderNoteNameTemplate`
  - names the folder note when you chose the location yourself.
- `folderNoteTitleTemplate` / `folderNoteAliasesTemplate`
  - the `title` and the alias a reorder or rename writes into it. Either empty leaves that property
    alone.

## UI

- `shouldShowOperationNotices`
  - show the running and finished notices — see [33 Operation notices](<./33 Operation notices.md>).
- `shouldBlockVaultDuringOperations`
  - report progress in a dialog that blocks the vault instead of in a notice, and keep it up until the
    link updates the operation queued have drained — see
    [33 Operation notices](<./33 Operation notices.md>).
- `shouldShowModalInstructions`
  - show the controls that override a setting for one operation: the keyboard-hint line at the bottom of
    the pickers, the reorder dialog's `Include files` checkbox, and the split picker's `Create` / `Merge`
    switch. Turn it off and this settings page is the only place those choices are made.
- `pickerRecencyOrder`
  - which recency a picker offers first when you have typed nothing: the destinations of completed
    operations, or the folder you are currently in. They only disagree once you have run an operation
    without navigating to where the next one should go.
- `shouldAddCommandsToSubmenu`
  - group this plugin's context-menu entries under one submenu instead of listing them inline.

## Internal

- `releaseNotesShown`
  - the versions whose release notes you have already been shown. Bookkeeping, not something to set.
