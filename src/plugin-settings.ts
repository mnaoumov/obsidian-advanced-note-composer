import { PathSettings } from 'obsidian-dev-utils/obsidian/path-settings';
import { EmptyFolderBehavior } from 'obsidian-dev-utils/obsidian/vault';

export enum Action {
  Merge = 'Merge',
  Split = 'Split'
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
   * merged away, the folder tree left behind is litter (issue #160).
   */
  public emptyFolderBehaviorAfterMergingFolder = EmptyFolderBehavior.Delete;

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
