import {
  describe,
  expect,
  it
} from 'vitest';

import {
  Action,
  FrontmatterMergeStrategy,
  FrontmatterTitleMode,
  PluginSettings,
  TextAfterExtractionMode
} from './plugin-settings.ts';

describe('Action enum', () => {
  it('should have Merge value', () => {
    expect(Action.Merge).toBe('Merge');
  });

  it('should have Split value', () => {
    expect(Action.Split).toBe('Split');
  });
});

describe('FrontmatterMergeStrategy enum', () => {
  it('should have KeepOriginalFrontmatter value', () => {
    expect(FrontmatterMergeStrategy.KeepOriginalFrontmatter).toBe('KeepOriginalFrontmatter');
  });

  it('should have MergeAndPreferNewValues value', () => {
    expect(FrontmatterMergeStrategy.MergeAndPreferNewValues).toBe('MergeAndPreferNewValues');
  });

  it('should have MergeAndPreferOriginalValues value', () => {
    expect(FrontmatterMergeStrategy.MergeAndPreferOriginalValues).toBe('MergeAndPreferOriginalValues');
  });

  it('should have PreserveBothOriginalAndNewFrontmatter value', () => {
    expect(FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter).toBe('PreserveBothOriginalAndNewFrontmatter');
  });

  it('should have ReplaceWithNewFrontmatter value', () => {
    expect(FrontmatterMergeStrategy.ReplaceWithNewFrontmatter).toBe('ReplaceWithNewFrontmatter');
  });
});

describe('FrontmatterTitleMode enum', () => {
  it('should have None value', () => {
    expect(FrontmatterTitleMode.None).toBe('None');
  });

  it('should have UseAlways value', () => {
    expect(FrontmatterTitleMode.UseAlways).toBe('UseAlways');
  });

  it('should have UseForInvalidTitleOnly value', () => {
    expect(FrontmatterTitleMode.UseForInvalidTitleOnly).toBe('UseForInvalidTitleOnly');
  });
});

describe('TextAfterExtractionMode enum', () => {
  it('should have EmbedNewFile value', () => {
    expect(TextAfterExtractionMode.EmbedNewFile).toBe('embed');
  });

  it('should have LinkToNewFile value', () => {
    expect(TextAfterExtractionMode.LinkToNewFile).toBe('link');
  });

  it('should have None value', () => {
    expect(TextAfterExtractionMode.None).toBe('none');
  });
});

describe('PluginSettings', () => {
  it('should have correct default values', () => {
    const settings = new PluginSettings();
    expect(settings.defaultFrontmatterMergeStrategy).toBe(FrontmatterMergeStrategy.MergeAndPreferNewValues);
    expect(settings.frontmatterTitleMode).toBe(FrontmatterTitleMode.UseForInvalidTitleOnly);
    expect(settings.mergeTemplate).toBe('\n\n{{content}}');
    expect(settings.releaseNotesShown).toEqual([]);
    expect(settings.replacement).toBe('_');
    expect(settings.shouldAddCommandsToSubmenu).toBe(true);
    expect(settings.shouldAddInvalidTitleToNoteAlias).toBe(true);
    expect(settings.shouldAllowOnlyCurrentFolderByDefault).toBe(false);
    expect(settings.shouldAllowSplitIntoUnresolvedPathByDefault).toBe(true);
    expect(settings.shouldApplyTextAfterExtractionToSameFile).toBe(false);
    expect(settings.shouldAskBeforeMerging).toBe(true);
    expect(settings.shouldAskBeforeSplitting).toBe(true);
    expect(settings.shouldFixFootnotesByDefault).toBe(true);
    expect(settings.shouldIncludeChildFoldersWhenMergingByDefault).toBe(true);
    expect(settings.shouldIncludeChildFoldersWhenSwappingByDefault).toBe(true);
    expect(settings.shouldIncludeFrontmatterWhenSplittingByDefault).toBe(false);
    expect(settings.shouldIncludeParentFoldersWhenMergingByDefault).toBe(true);
    expect(settings.shouldIncludeParentFoldersWhenSwappingByDefault).toBe(true);
    expect(settings.shouldKeepHeadingsWhenSplittingContent).toBe(true);
    expect(settings.shouldLockAllNotesWhenMarkingSelection).toBe(false);
    expect(settings.shouldMergeHeadingsByDefault).toBe(false);
    expect(settings.shouldOpenNoteAfterMerge).toBe(false);
    expect(settings.shouldOpenTargetNoteAfterSplit).toBe(false);
    expect(settings.shouldReplaceInvalidTitleCharacters).toBe(true);
    expect(settings.shouldRunTemplaterOnDestinationFile).toBe(false);
    expect(settings.shouldShowModalInstructions).toBe(true);
    expect(settings.shouldSwapEntireFolderStructureByDefault).toBe(true);
    expect(settings.shouldTreatTitleAsPathByDefault).toBe(true);
    expect(settings.shouldUseSourceTitleWhenTargetHasNoTitle).toBe(false);
    expect(settings.splitTemplate).toBe('');
    expect(settings.splitToExistingFileTemplate).toBe(Action.Split);
    expect(settings.textAfterExtractionMode).toBe(TextAfterExtractionMode.LinkToNewFile);
  });

  it('should get and set includePaths', () => {
    const settings = new PluginSettings();
    settings.includePaths = ['path1', 'path2'];
    expect(settings.includePaths).toEqual(['path1', 'path2']);
  });

  it('should get and set excludePaths', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['excluded'];
    expect(settings.excludePaths).toEqual(['excluded']);
  });

  it('should delegate isPathIgnored to PathSettings', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['secret'];
    expect(settings.isPathIgnored('secret/file.md')).toBe(true);
  });

  it('should not ignore paths that are not excluded', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['secret'];
    expect(settings.isPathIgnored('public/file.md')).toBe(false);
  });

  it('should include all paths when includePaths is empty', () => {
    const settings = new PluginSettings();
    expect(settings.isPathIgnored('anything/file.md')).toBe(false);
  });

  it('should ignore paths not in includePaths when includePaths is set', () => {
    const settings = new PluginSettings();
    settings.includePaths = ['allowed'];
    expect(settings.isPathIgnored('not-allowed/file.md')).toBe(true);
  });
});
