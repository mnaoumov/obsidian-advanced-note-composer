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
 * What `Flatten folder...` promotes out of the chosen folder.
 *
 * `AllChildren` is the original behavior and stays the default, so nothing changes for an existing vault
 * and no `registerLegacySettingsConverter` is needed. The two folder-only members answer issues #170 and
 * #171: promote the folder's sub-folders while the folder itself keeps its own files (and its attachment
 * folder), either one level down (`ChildFoldersOnly`) or at any depth (`AllFoldersRecursively`).
 *
 * The two axes a flatten could have — WHAT moves and HOW DEEP it looks — are deliberately collapsed into
 * one dropdown rather than a scope enum plus a "recursive" toggle: the only combination anyone asked for
 * is folders-at-any-depth, and a recursive variant of `AllChildren` (dissolving every descendant file into
 * the parent) is a different operation nobody requested. The enum is the extension point if they do.
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

  /**
   * What `Flatten folder...` promotes. Defaults to the original "every direct child" behavior, so the
   * folder-only modes (issues #170/#171) are strictly opt-in.
   */
  public flattenMode = FlattenMode.AllChildren;

  public frontmatterTitleMode = FrontmatterTitleMode.UseForInvalidTitleOnly;

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
  public smartCutAndPasteTemplate = '';
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
