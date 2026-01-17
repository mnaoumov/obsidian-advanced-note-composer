import { PathSettings } from 'obsidian-dev-utils/obsidian/Plugin/PathSettings';

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
  public defaultFrontmatterMergeStrategy = FrontmatterMergeStrategy.MergeAndPreferNewValues;
  public frontmatterTitleMode = FrontmatterTitleMode.UseForInvalidTitleOnly;
  public mergeTemplate = '\n\n{{content}}';
  public releaseNotesShown: readonly string[] = [];
  public replacement = '_';
  public shouldAddInvalidTitleToNoteAlias = true;
  public shouldAllowOnlyCurrentFolderByDefault = false;
  public shouldAllowSplitIntoUnresolvedPathByDefault = true;
  public shouldAskBeforeMerging = true;
  public shouldFixFootnotesByDefault = true;
  public shouldIncludeChildFoldersWhenMergingByDefault = true;
  public shouldIncludeChildFoldersWhenSwappingByDefault = true;
  public shouldIncludeFrontmatterWhenSplittingByDefault = false;
  public shouldIncludeParentFoldersWhenMergingByDefault = true;
  public shouldIncludeParentFoldersWhenSwappingByDefault = true;
  public shouldKeepHeadingsWhenSplittingContent = true;
  public shouldMergeHeadingsByDefault = false;
  public shouldOpenNoteAfterMerge = false;
  public shouldOpenTargetNoteAfterSplit = false;
  public shouldReplaceInvalidTitleCharacters = true;
  public shouldRunTemplaterOnDestinationFile = false;
  public shouldSwapEntireFolderStructureByDefault = true;
  public shouldTreatTitleAsPathByDefault = true;
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
}
