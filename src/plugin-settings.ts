import { PathSettings } from 'obsidian-dev-utils/obsidian/path-settings';

export enum Action {
  Merge = 'Merge',
  Split = 'Split'
}

/**
 * What a folder merge does with the folders it empties. A plugin-local **wrapper** around the
 * `obsidian-dev-utils` `EmptyFolderBehavior`, not that enum itself, because of the fourth member: keeping the
 * merged folder while deleting the folders under it (issue #167) is a change to WHICH paths are offered to
 * `cleanupEmptyFolders`, not a new per-path behavior, so it cannot be expressed as a dev-utils value. The
 * three original members deliberately reuse `EmptyFolderBehavior`'s exact string values, so every
 * already-persisted setting stays valid and no legacy-settings converter is needed. Do not "simplify" this
 * back to the dev-utils enum.
 */
export enum EmptyFolderBehaviorAfterMergingFolder {
  Delete = 'Delete',
  DeleteSubFoldersOnly = 'DeleteSubFoldersOnly',
  DeleteWithEmptyParents = 'DeleteWithEmptyParents',
  Keep = 'Keep'
}

/**
 * What a flatten promotes out of the chosen folder.
 *
 * `AllChildren` is the original behavior. The two folder-only members answer issues #170 and #171:
 * promote the folder's sub-folders while the folder itself keeps its own files (and its attachment
 * folder), either one level down (`ChildFoldersOnly`) or at any depth (`AllFoldersRecursively`).
 *
 * The two axes a flatten could have — WHAT moves and HOW DEEP it looks — are deliberately collapsed into
 * three cells rather than a scope enum plus a "recursive" toggle: the only combination anyone asked for
 * is folders-at-any-depth, and a recursive variant of `AllChildren` (dissolving every descendant file into
 * the parent) is a different operation nobody requested. The enum is the extension point if they do.
 *
 * **No longer a setting** (issue #177): each member is registered as its own folder-menu command, so the
 * variant is chosen when the command is invoked instead of being pre-committed in the settings tab. The
 * `Flatten mode` dropdown that used to select it is gone, and a `flattenMode` key left in an existing
 * `data.json` is simply ignored — nothing to migrate, because there is no longer a setting to migrate to.
 */
export enum FlattenMode {
  AllChildren = 'AllChildren',
  AllFoldersRecursively = 'AllFoldersRecursively',
  ChildFoldersOnly = 'ChildFoldersOnly'
}

export enum FrontmatterMergeStrategy {
  KeepOriginalFrontmatter = 'KeepOriginalFrontmatter',
  MergeAndPreferNewValues = 'MergeAndPreferNewValues',
  MergeAndPreferOriginalValues = 'MergeAndPreferOriginalValues',
  PreserveBothOriginalAndNewFrontmatter = 'PreserveBothOriginalAndNewFrontmatter',
  ReplaceWithNewFrontmatter = 'ReplaceWithNewFrontmatter'
}

export enum FrontmatterTitleMode {
  None = 'None',
  UseAlways = 'UseAlways',
  UseForInvalidTitleOnly = 'UseForInvalidTitleOnly'
}

/**
 * Where `Merge folder contents into a single file...` creates the merged note (issue #178).
 *
 * The report is ambiguous — it says the file "is moved to default folder right away" AND asks to be able
 * to "keep this new file in the parent folder", which is what already happens. `resolveTargetPath` creates
 * the note beside the folder with `vault.create`; nothing is ever moved, and Obsidian's
 * `Default location for new notes` is not consulted at any point. Rather than guess which of the two
 * readings was meant, all three positions are offered — the dropdown costs little more than either one
 * alone, and `BesideFolder` keeps today's behavior as the default.
 */
export enum MergeFolderIntoFileLocation {
  /** Today's behavior, and the default: beside the merged folder, in the folder's own parent. */
  BesideFolder = 'BesideFolder',

  /** Obsidian's own `Default location for new notes`, resolved through `fileManager.getNewFileParent`. */
  DefaultNewNoteLocation = 'DefaultNewNoteLocation',

  /** Inside the merged folder itself. */
  InsideFolder = 'InsideFolder'
}

/**
 * How a finished smart cut & paste move announces itself in the target note (issue #176).
 *
 * Selecting the moved text is the original behavior and stays the default, so nothing changes for an
 * existing vault and no `registerLegacySettingsConverter` is needed — a `data.json` without the key
 * simply gets {@link SmartCutAndPasteCompletionFeedback.SelectMovedContent}.
 *
 * The reason the other two exist: a selection in the target looks exactly like the plugin's own
 * marked-selection highlight in the source, so "this text is still marked, waiting to be moved" and
 * "the move finished, here is where it landed" are indistinguishable — most confusingly while the notes
 * are locked. {@link SmartCutAndPasteCompletionFeedback.Notice} therefore still moves the cursor onto
 * the moved text (leaving text at the cursor and the cursor elsewhere is incoherent — the same
 * reasoning that makes the at-cursor move always jump) but leaves it collapsed, and says so in a
 * notice instead of by highlighting.
 *
 * All three are gated by the same jump settings: with the move's jump turned off, nothing happens at
 * all — no cursor move, no notice.
 */
export enum SmartCutAndPasteCompletionFeedback {
  Notice = 'Notice',
  SelectMovedContent = 'SelectMovedContent',
  SelectMovedContentAndNotice = 'SelectMovedContentAndNotice'
}

/**
 * Which smart cut & paste move a split is: the move at the cursor (`Move marked selection here`, plain or
 * advanced, including the `Move marked selection at cursor` notice button), or a move to the top/bottom of
 * the target note. Supplied by the command handler — only it knows which move this is — and its presence on
 * a `SplitComposer` is what marks the split as a smart cut & paste move at all (issue #174).
 *
 * `AtCursor` deliberately has NO template setting of its own: `smartCutAndPasteTemplate` IS its template,
 * and simultaneously the fallback for the other two. That asymmetry is what keeps the per-direction
 * overrides migration-free — see {@link PluginSettings.smartCutAndPasteToTopTemplate}.
 */
export enum SmartCutAndPasteMoveKind {
  AtCursor = 'AtCursor',
  ToBottom = 'ToBottom',
  ToTop = 'ToTop'
}

export enum TextAfterExtractionMode {
  EmbedNewFile = 'embed',
  LinkToNewFile = 'link',
  None = 'none'
}

export class PluginSettings {
  /**
   * Extensions that make a file an attachment rather than a note, matched against the file's whole name
   * by `obsidian-dev-utils` `isTreatedAsAttachment` — so a multi-part extension like `.excalidraw.md` is
   * written out in full. Such a file is never merged — inlining an Excalidraw drawing's raw payload into
   * a note is never what the user wanted (issue #160). It is moved like any other attachment instead: by
   * the folder merges (into a single file, or into another folder) and by the file merge that owns it
   * (issue #161).
   */
  public attachmentExtensions: string[] = ['.excalidraw.md'];

  public defaultFrontmatterMergeStrategy = FrontmatterMergeStrategy.MergeAndPreferNewValues;

  /**
   * What happens to the folders a folder merge empties. Defaults to deleting them: once every note is
   * merged away, the folder tree left behind is litter (issue #160). `DeleteSubFoldersOnly` is the
   * in-between option (issue #167) for a folder whose own name matters but whose children's do not.
   */
  public emptyFolderBehaviorAfterMergingFolder = EmptyFolderBehaviorAfterMergingFolder.Delete;

  public frontmatterTitleMode = FrontmatterTitleMode.UseForInvalidTitleOnly;

  /**
   * Where a folder merge creates the merged note (issue #178). Defaults to `BesideFolder`, which is the
   * existing behavior, so no `registerLegacySettingsConverter` is needed — the same reasoning as
   * `flattenMode` and `shouldSplitRecursivelyIntoDefaultNewNoteFolder`.
   */
  public mergeFolderIntoFileLocation = MergeFolderIntoFileLocation.BesideFolder;

  public mergeFolderIntoFileNoteNameTemplate = '';
  public mergeTemplate = '\n\n{{content}}';
  public releaseNotesShown: readonly string[] = [];
  public replacement = '_';
  public shouldAddCommandsToSubmenu = true;
  public shouldAddInvalidTitleToNoteAlias = true;
  public shouldAllowOnlyCurrentFolderByDefault = false;
  public shouldAllowSplitIntoUnresolvedPathByDefault = true;
  public shouldAlwaysMergeExcludedItems = false;
  public shouldApplyTextAfterExtractionToSameFile = false;
  public shouldAskBeforeFlattening = true;
  public shouldAskBeforeMerging = true;
  public shouldAskBeforeMovingFolder = true;
  public shouldAskBeforeSplitting = true;
  public shouldAskBeforeSwapping = true;
  public shouldBlockCommandsOnExcludedPaths = false;
  public shouldConvertFoldersToHeadingsWhenMergingFolder = false;
  public shouldFixFootnotesByDefault = true;
  public shouldIncludeChildFoldersWhenMergingByDefault = true;
  public shouldIncludeChildFoldersWhenSwappingByDefault = true;
  public shouldIncludeFrontmatterWhenSplittingByDefault = false;
  public shouldIncludeParentFoldersWhenMergingByDefault = true;
  public shouldIncludeParentFoldersWhenSwappingByDefault = true;
  public shouldJumpToMovedContentToBottom = true;
  public shouldJumpToMovedContentToTop = true;
  public shouldKeepHeadingsWhenSplittingContent = true;
  public shouldLockAllNotesWhenMarkingSelection = false;
  public shouldMergeHeadingsByDefault = false;
  public shouldMoveAttachmentsWhenMergingFile = true;
  public shouldMoveAttachmentsWhenMergingFolder = true;
  public shouldOpenNoteAfterMerge = false;
  public shouldOpenTargetNoteAfterSplit = false;
  public shouldReplaceInvalidTitleCharacters = true;
  public shouldRunTemplaterOnDestinationFile = false;
  public shouldShowModalInstructions = true;
  public shouldShowMoveAtCursorButton = true;
  public shouldShowMoveToBottomButton = true;
  public shouldShowMoveToTopButton = true;

  /**
   * Whether every operation reports itself — a progress notice while it runs, and a notice naming what it
   * did once it finishes (issue #182). Covers merge, split/extract, swap, move, flatten, rename heading and
   * reorder headings alike; refusals ("this path is ignored in the plugin settings") and errors are always
   * shown and are NOT gated by this.
   *
   * Deliberately NOT folded into `shouldShowSmartCutNotice`, which gates an *interactive* notice — turning
   * that one off removes buttons, not just information — nor into
   * `smartCutAndPasteCompletionFeedback`, which already owns how a finished smart cut & paste announces
   * itself (so a move is never reported twice).
   *
   * The progress notice is what carries the operation's Cancel button, so turning this off also removes
   * that affordance; cancelling then goes through the lock indicator's right-click unlock, which aborts the
   * operation just the same.
   *
   * Needs no `registerLegacySettingsConverter` — an existing `data.json` simply has no such key and gets
   * `true`. Unlike the plugin's other migration-free settings, that default deliberately CHANGES behavior
   * for an existing vault: reporting every operation IS the feature the issue asks for. Do not "fix" this
   * later by flipping the default.
   */
  public shouldShowOperationNotices = true;
  public shouldShowSmartCutNotice = true;
  public shouldSplitHeadingsAutomatically = false;
  public shouldSplitIntoFolder = false;

  /**
   * Whether `Split note by headings recursively...` roots the tree it produces in Obsidian's own
   * `Default location for new notes` instead of beside the source note (issue #173).
   *
   * **Root-only, deliberately.** Only the FIRST pass — the note the command was invoked on — resolves
   * against that folder; every deeper pass keeps creating its note beside its source, which is what makes
   * each pass nest one level deeper. Redirecting every pass would put every produced note in one flat
   * folder and destroy the hierarchy the command exists to build, so it is not offered.
   *
   * Off by default, which reproduces the pre-#173 behavior exactly — which is what makes this setting need
   * no `registerLegacySettingsConverter`: an existing `data.json` simply has no such key and gets `false`.
   *
   * With Obsidian set to `Same folder as current file` the setting changes nothing, because that resolution
   * IS the beside-the-source behavior.
   */
  public shouldSplitRecursivelyIntoDefaultNewNoteFolder = false;
  public shouldSwapEntireFolderStructureByDefault = true;
  public shouldTreatTitleAsPathByDefault = true;
  public shouldUseSourceTitleWhenTargetHasNoTitle = false;

  /**
   * How a finished smart cut & paste move announces itself in the target note (issue #176). Defaults to
   * the original select-the-moved-text behavior, so the notice modes are strictly opt-in.
   */
  public smartCutAndPasteCompletionFeedback = SmartCutAndPasteCompletionFeedback.SelectMovedContent;

  /**
   * The template a smart cut & paste move applies, and the base of the per-direction chain (issue #174):
   *
   * ```text
   * at cursor  →  smartCutAndPasteTemplate                                   →  split → merge chain
   * to top     →  smartCutAndPasteToTopTemplate    → smartCutAndPasteTemplate →  split → merge chain
   * to bottom  →  smartCutAndPasteToBottomTemplate → smartCutAndPasteTemplate →  split → merge chain
   * ```
   *
   * So this is BOTH the at-cursor template and the default for the two edge moves. Resolved by
   * `resolveSmartCutAndPasteTemplate`; empty everywhere falls through to the ordinary split → merge chain.
   */
  public smartCutAndPasteTemplate = '';

  /**
   * Optional override of {@link smartCutAndPasteTemplate} for `Move marked selection to bottom of file`.
   * Empty (the default) means "use {@link smartCutAndPasteTemplate}".
   */
  public smartCutAndPasteToBottomTemplate = '';

  /**
   * Optional override of {@link smartCutAndPasteTemplate} for `Move marked selection to top of file` — the
   * direction issue #162 wanted its own formatting for (a blank line after the frontmatter), which one
   * template shared by all three moves could not express.
   *
   * Empty (the default) means "use {@link smartCutAndPasteTemplate}", which is exactly the pre-#174
   * behavior — an existing `data.json` has no such key, gets `''`, and keeps applying its shared template
   * to all three moves. That is why these overrides need no `registerLegacySettingsConverter`.
   */
  public smartCutAndPasteToTopTemplate = '';
  public splitIntoFolderNoteNameTemplate = '';
  public splitTemplate = '';
  public splitToExistingFileTemplate = Action.Split;
  public textAfterExtractionMode = TextAfterExtractionMode.LinkToNewFile;

  public get excludePaths(): string[] {
    return this._pathSettings.excludePaths;
  }

  public set excludePaths(value: string[]) {
    this._pathSettings.excludePaths = value;
  }

  public get includePaths(): string[] {
    return this._pathSettings.includePaths;
  }

  public set includePaths(value: string[]) {
    this._pathSettings.includePaths = value;
  }

  private readonly _pathSettings = new PathSettings();

  public isPathIgnored(path: string): boolean {
    return this._pathSettings.isPathIgnored(path);
  }

  /**
   * Whether an Advanced Note Composer command must be blocked (hidden) on the given path: only when the
   * `shouldBlockCommandsOnExcludedPaths` setting is on AND the path is excluded/ignored in the settings
   * (issue #93). When off, commands stay visible on excluded paths and show an "ignored" notice on
   * trigger instead.
   *
   * @param path - The path to check.
   * @returns Whether commands must be blocked on the path.
   */
  public shouldBlockCommandOnPath(path: string): boolean {
    return this.shouldBlockCommandsOnExcludedPaths && this.isPathIgnored(path);
  }
}
