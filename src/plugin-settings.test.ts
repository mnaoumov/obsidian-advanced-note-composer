import {
  describe,
  expect,
  it
} from 'vitest';

import {
  Action,
  FlattenMode,
  FrontmatterMergeStrategy,
  FrontmatterTitleMode,
  MergeFolderIntoFileLocation,
  PluginSettings,
  SmartCutAndPasteMoveKind,
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

describe('FlattenMode enum', () => {
  it('should have AllChildren value', () => {
    expect(FlattenMode.AllChildren).toBe('AllChildren');
  });

  it('should have AllFoldersRecursively value', () => {
    expect(FlattenMode.AllFoldersRecursively).toBe('AllFoldersRecursively');
  });

  it('should have ChildFoldersOnly value', () => {
    expect(FlattenMode.ChildFoldersOnly).toBe('ChildFoldersOnly');
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

describe('SmartCutAndPasteMoveKind enum', () => {
  it('should have AtCursor value', () => {
    expect(SmartCutAndPasteMoveKind.AtCursor).toBe('AtCursor');
  });

  it('should have ToBottom value', () => {
    expect(SmartCutAndPasteMoveKind.ToBottom).toBe('ToBottom');
  });

  it('should have ToTop value', () => {
    expect(SmartCutAndPasteMoveKind.ToTop).toBe('ToTop');
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
    // Both halves of the command-visibility filter start empty (issue #198), which is what reproduces the
    // Removed `shouldBlockCommandsOnExcludedPaths` toggle's off-by-default behavior: nothing is blocked.
    expect(settings.commandExcludePaths).toEqual([]);
    expect(settings.commandIncludePaths).toEqual([]);
    expect(settings.defaultFrontmatterMergeStrategy).toBe(FrontmatterMergeStrategy.MergeAndPreferNewValues);
    expect(settings.frontmatterTitleMode).toBe(FrontmatterTitleMode.UseForInvalidTitleOnly);
    // `BesideFolder` IS the pre-#178 behavior, which is what makes the new setting need no legacy converter.
    expect(settings.mergeFolderIntoFileLocation).toBe(MergeFolderIntoFileLocation.BesideFolder);
    expect(settings.mergeTemplate).toBe('\n\n{{content}}');
    // Empty IS the pre-#196 behavior — the transform is skipped entirely — so no legacy converter is needed.
    expect(settings.nameTransformTemplate).toBe('');
    expect(settings.releaseNotesShown).toEqual([]);
    expect(settings.replacement).toBe('_');
    expect(settings.shouldAddCommandsToSubmenu).toBe(true);
    expect(settings.shouldAddInvalidTitleToNoteAlias).toBe(true);
    expect(settings.shouldAllowOnlyCurrentFolderByDefault).toBe(false);
    expect(settings.shouldAllowSplitIntoUnresolvedPathByDefault).toBe(true);
    expect(settings.shouldApplyTextAfterExtractionToSameFile).toBe(false);
    expect(settings.shouldAskBeforeFlattening).toBe(true);
    expect(settings.shouldAskBeforeMerging).toBe(true);
    expect(settings.shouldAskBeforeMovingFolder).toBe(true);
    expect(settings.shouldAskBeforeSplitting).toBe(true);
    expect(settings.shouldAskBeforeSwapping).toBe(true);
    expect(settings.shouldFixFootnotesByDefault).toBe(true);
    expect(settings.shouldIncludeChildFoldersWhenMergingByDefault).toBe(true);
    expect(settings.shouldIncludeChildFoldersWhenSwappingByDefault).toBe(true);
    expect(settings.shouldIncludeFrontmatterWhenSplittingByDefault).toBe(false);
    expect(settings.shouldIncludeParentFoldersWhenMergingByDefault).toBe(true);
    expect(settings.shouldIncludeParentFoldersWhenSwappingByDefault).toBe(true);
    expect(settings.shouldJumpToMovedContentToBottom).toBe(true);
    expect(settings.shouldJumpToMovedContentToTop).toBe(true);
    expect(settings.shouldKeepHeadingsWhenSplittingContent).toBe(true);
    expect(settings.shouldLockAllNotesWhenMarkingSelection).toBe(false);
    expect(settings.shouldMergeHeadingsByDefault).toBe(false);
    // Both default OFF, so an existing vault behaves exactly as it did before issues #212 / #215 and
    // Neither needs a legacy-settings converter.
    expect(settings.shouldOpenFirstNoteAfterMergingFolder).toBe(false);
    expect(settings.shouldOpenNoteAfterMerge).toBe(false);
    expect(settings.shouldOpenNoteAfterMergingFolderIntoFile).toBe(false);
    expect(settings.shouldOpenTargetNoteAfterSplit).toBe(false);
    expect(settings.shouldReplaceInvalidTitleCharacters).toBe(true);
    expect(settings.shouldRunTemplaterOnDestinationFile).toBe(false);
    expect(settings.shouldShowModalInstructions).toBe(true);
    expect(settings.shouldShowMoveAtCursorButton).toBe(true);
    expect(settings.shouldShowMoveToBottomButton).toBe(true);
    expect(settings.shouldShowMoveToTopButton).toBe(true);
    expect(settings.shouldShowSmartCutNotice).toBe(true);
    expect(settings.shouldSplitHeadingsAutomatically).toBe(false);
    expect(settings.shouldSplitIntoFolder).toBe(false);
    // The default IS the pre-#173 behavior, which is what makes the new setting need no legacy converter.
    expect(settings.shouldSplitRecursivelyIntoDefaultNewNoteFolder).toBe(false);
    expect(settings.shouldSwapEntireFolderStructureByDefault).toBe(true);
    expect(settings.shouldTreatTitleAsPathByDefault).toBe(true);
    expect(settings.shouldUseSourceTitleWhenTargetHasNoTitle).toBe(false);
    expect(settings.smartCutAndPasteTemplate).toBe('');
    // Both overrides default to empty, which reproduces the pre-#174 behavior exactly (the shared template
    // Applies to every direction) — that is what makes them need no legacy converter.
    expect(settings.smartCutAndPasteToBottomTemplate).toBe('');
    expect(settings.smartCutAndPasteToTopTemplate).toBe('');
    expect(settings.splitIntoFolderNoteNameTemplate).toBe('');
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

  it('should treat a path string entry as the folder and its entire subtree', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['Inbox'];
    expect(settings.isPathIgnored('Inbox')).toBe(true);
    expect(settings.isPathIgnored('Inbox/note.md')).toBe(true);
    expect(settings.isPathIgnored('Inbox/sub/deep.md')).toBe(true);
    expect(settings.isPathIgnored('Other/note.md')).toBe(false);
  });

  it('should match only the folder itself for a regular expression entry anchored to it', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['/^Inbox$/'];
    expect(settings.isPathIgnored('Inbox')).toBe(true);
    expect(settings.isPathIgnored('Inbox/note.md')).toBe(false);
    expect(settings.isPathIgnored('Inbox/sub/deep.md')).toBe(false);
    expect(settings.isPathIgnored('Other/note.md')).toBe(false);
  });
});

describe('PluginSettings.commandIncludePaths / commandExcludePaths', () => {
  it('should get and set commandIncludePaths', () => {
    const settings = new PluginSettings();
    settings.commandIncludePaths = ['path1', 'path2'];
    expect(settings.commandIncludePaths).toEqual(['path1', 'path2']);
  });

  it('should get and set commandExcludePaths', () => {
    const settings = new PluginSettings();
    settings.commandExcludePaths = ['excluded'];
    expect(settings.commandExcludePaths).toEqual(['excluded']);
  });

  // The two filters are backed by SEPARATE PathSettings instances (issue #198) — writing one must not
  // Leak into the other, which is the whole point of the split.
  it('should keep the command filter independent of the content filter', () => {
    const settings = new PluginSettings();
    settings.commandExcludePaths = ['blocked'];
    settings.excludePaths = ['ignored'];
    expect(settings.commandExcludePaths).toEqual(['blocked']);
    expect(settings.excludePaths).toEqual(['ignored']);
  });
});

describe('PluginSettings.shouldBlockCommandOnPath', () => {
  it('should block a path listed in commandExcludePaths', () => {
    const settings = new PluginSettings();
    settings.commandExcludePaths = ['secret'];
    expect(settings.shouldBlockCommandOnPath('secret/file.md')).toBe(true);
  });

  it('should not block a path outside commandExcludePaths', () => {
    const settings = new PluginSettings();
    settings.commandExcludePaths = ['secret'];
    expect(settings.shouldBlockCommandOnPath('public/file.md')).toBe(false);
  });

  it('should block a path outside commandIncludePaths when it is set', () => {
    const settings = new PluginSettings();
    settings.commandIncludePaths = ['allowed'];
    expect(settings.shouldBlockCommandOnPath('elsewhere/file.md')).toBe(true);
    expect(settings.shouldBlockCommandOnPath('allowed/file.md')).toBe(false);
  });

  it('should block nothing when both command path lists are empty', () => {
    const settings = new PluginSettings();
    expect(settings.shouldBlockCommandOnPath('anything/file.md')).toBe(false);
  });

  // Issue #198's actual ask: a path excluded from merges/splits keeps its commands unless it is ALSO
  // Listed in the command filter. Before the split, `excludePaths` alone could hide them.
  it('should not block a path that is only in excludePaths', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['secret'];
    expect(settings.shouldBlockCommandOnPath('secret/file.md')).toBe(false);
  });

  it('should not be affected by includePaths', () => {
    const settings = new PluginSettings();
    settings.includePaths = ['allowed'];
    expect(settings.shouldBlockCommandOnPath('elsewhere/file.md')).toBe(false);
  });
});
