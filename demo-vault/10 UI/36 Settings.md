# Settings

Every setting the plugin has, listed by the key it is stored under in `data.json` and grouped by the
page it lives on in `Settings -> Advanced Note Composer`. The notes elsewhere in this vault show these
in action; this one is the reference you scan when you know roughly what you want and need the name of
the thing that does it. To find a setting by its display name instead, see
[35 Finding a setting](<./35 Finding a setting.md>).

## Merge

- `mergeTemplate`
  - wraps merged content. `{{content}}` is required — see [31 Templates](<../09 Titles, links and frontmatter/31 Templates.md>).
- `shouldAskBeforeMerging`
  - show a confirmation dialog before a merge runs.
- `shouldMergeHeadingsByDefault`
  - merge under a matching heading in the target instead of appending, by default.
- `shouldOpenNoteAfterMerge`
  - open the target note once a merge lands.
- `shouldMoveAttachmentsWhenMergingFile`
  - carry a merged note's own attachments with it.
- `shouldAlwaysMergeExcludedItems`
  - merge notes on ignored paths too, instead of skipping and reporting them.
- `attachmentExtensions`
  - markdown files that are really attachments (default `.excalidraw.md`), never merged as text.
- `shouldUseSourceTitleWhenTargetHasNoTitle`
  - give the merged note the source's title when the target has none of its own.

## Merge folder

- `shouldIncludeChildFoldersWhenMergingByDefault`
  - include the folder's subfolders in a folder merge.
- `shouldIncludeParentFoldersWhenMergingByDefault`
  - mirror the folder's parents into the destination.
- `shouldOpenFirstNoteAfterMergingFolder`
  - open the destination folder's first note once a folder merge lands.
- `mergeFolderIntoFileLocation`
  - where the note produced by `Merge folder contents into a single file` is placed.
- `mergeFolderIntoFileNoteNameTemplate`
  - names that note. Empty means name it after the folder.
- `shouldConvertFoldersToHeadingsWhenMergingFolder`
  - mirror the folder hierarchy as headings in the merged note.
- `shouldMoveAttachmentsWhenMergingFolder`
  - carry the merged notes' attachments into the merged note's attachment folder.
- `shouldOpenNoteAfterMergingFolderIntoFile`
  - open the merged note at the very end.
- `emptyFolderBehaviorAfterMergingFolder`
  - what happens to folders the merge empties: delete, delete sub-folders only, delete with empty
    parents, or keep.

## Split and extract

- `splitTemplate`
  - wraps content split or extracted into a new note. Falls back to `mergeTemplate`.
- `splitToExistingFileTemplate`
  - which action's template applies when the target already exists, so a split into an existing note
    can be formatted as a merge.
- `defaultSplitTargetMode`
  - whether the picker opens in `Create` or `Merge` — see [10 Create or merge when splitting](<../03 Split/10 Create or merge when splitting.md>).
- `shouldAskBeforeSplitting`
  - show a confirmation dialog before a split runs.
- `shouldOfferCurrentNoteWhenSplitting`
  - offer the note you are in as a target, for a same-note extraction.
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
- `shouldShowModalInstructions`
  - show the keyboard-hint line at the bottom of the pickers and dialogs.
- `shouldAddCommandsToSubmenu`
  - group this plugin's context-menu entries under one submenu instead of listing them inline.

## Internal

- `releaseNotesShown`
  - the versions whose release notes you have already been shown. Bookkeeping, not something to set.
