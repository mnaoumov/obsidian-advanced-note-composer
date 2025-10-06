export enum FrontmatterMergeStrategy {
  KeepOriginalFrontmatter = 'KeepOriginalFrontmatter',
  MergeAndPreferNewValues = 'MergeAndPreferNewValues',
  MergeAndPreferOriginalValues = 'MergeAndPreferOriginalValues',
  PreserveBothOriginalAndNewFrontmatter = 'PreserveBothOriginalAndNewFrontmatter',
  ReplaceWithNewFrontmatter = 'ReplaceWithNewFrontmatter'
}

export class PluginSettings {
  public defaultFrontmatterMergeStrategy = FrontmatterMergeStrategy.MergeAndPreferNewValues;
  public replacement = '_';
  public shouldAddInvalidTitleToFrontmatterTitleKey = true;
  public shouldAddInvalidTitleToNoteAlias = true;
  public shouldAllowOnlyCurrentFolderByDefault = false;
  public shouldAllowSplitIntoUnresolvedPathByDefault = true;
  public shouldFixFootnotesByDefault = true;
  public shouldHideCorePluginMenuItems = false;
  public shouldIncludeFrontmatterWhenSplittingByDefault = false;
  public shouldMergeHeadingsByDefault = false;
  public shouldOpenNoteAfterMerge = false;
  public shouldReplaceInvalidTitleCharacters = true;
  public shouldTreatTitleAsPathByDefault = true;
}
