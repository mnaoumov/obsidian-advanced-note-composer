import { getEnumValue } from 'obsidian-dev-utils/enum';
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  CommandCategoryContentPathsSettingName,
  CommandCategoryPathsSettingName
} from './plugin-settings.ts';

import {
  Action,
  COMMAND_CATEGORIES,
  COMMAND_MENU_PLACEMENTS,
  CommandCategory,
  CommandMenuPlacement,
  FlattenMode,
  FrontmatterMergeStrategy,
  FrontmatterTitleMode,
  MergeFolderIntoFileLocation,
  PluginSettings,
  SmartCutAndPasteMoveKind,
  SplitTargetMode,
  TextAfterExtractionMode
} from './plugin-settings.ts';

/**
 * One category paired with the two settings that narrow it, so the cases below run over all nine
 * categories — and touch all eighteen accessors — instead of spelling each one out.
 */
interface CommandCategoryPathProperties {
  readonly commandCategory: CommandCategory;
  readonly excludePathsPropertyName: CommandCategoryPathsSettingName;
  readonly includePathsPropertyName: CommandCategoryPathsSettingName;
}

const COMMAND_CATEGORY_PATH_PROPERTIES: readonly CommandCategoryPathProperties[] = [
  {
    commandCategory: CommandCategory.Create,
    excludePathsPropertyName: 'createCommandExcludePaths',
    includePathsPropertyName: 'createCommandIncludePaths'
  },
  {
    commandCategory: CommandCategory.Merge,
    excludePathsPropertyName: 'mergeCommandExcludePaths',
    includePathsPropertyName: 'mergeCommandIncludePaths'
  },
  {
    commandCategory: CommandCategory.MoveAndFlatten,
    excludePathsPropertyName: 'moveAndFlattenCommandExcludePaths',
    includePathsPropertyName: 'moveAndFlattenCommandIncludePaths'
  },
  {
    commandCategory: CommandCategory.Rename,
    excludePathsPropertyName: 'renameCommandExcludePaths',
    includePathsPropertyName: 'renameCommandIncludePaths'
  },
  {
    commandCategory: CommandCategory.Reorder,
    excludePathsPropertyName: 'reorderCommandExcludePaths',
    includePathsPropertyName: 'reorderCommandIncludePaths'
  },
  {
    commandCategory: CommandCategory.Select,
    excludePathsPropertyName: 'selectCommandExcludePaths',
    includePathsPropertyName: 'selectCommandIncludePaths'
  },
  {
    commandCategory: CommandCategory.SmartCutAndPaste,
    excludePathsPropertyName: 'smartCutAndPasteCommandExcludePaths',
    includePathsPropertyName: 'smartCutAndPasteCommandIncludePaths'
  },
  {
    commandCategory: CommandCategory.SplitAndExtract,
    excludePathsPropertyName: 'splitCommandExcludePaths',
    includePathsPropertyName: 'splitCommandIncludePaths'
  },
  {
    commandCategory: CommandCategory.Swap,
    excludePathsPropertyName: 'swapCommandExcludePaths',
    includePathsPropertyName: 'swapCommandIncludePaths'
  }
];

/**
 * The same pairing for the per-category CONTENT lists (issue #270) — what a category's commands may
 * TOUCH, as opposed to whether they are offered.
 *
 * EIGHT entries, not nine: `Select` has no content pair. A select writes nothing and never consults the
 * content filter, so the settings would be read by nothing — `plugin-settings.ts` carries the reasoning,
 * and the assertion below pins the omission to that one category so a second one cannot go missing
 * quietly.
 */
interface CommandCategoryContentPathProperties {
  readonly commandCategory: CommandCategory;
  readonly excludePathsPropertyName: CommandCategoryContentPathsSettingName;
  readonly includePathsPropertyName: CommandCategoryContentPathsSettingName;
}

const COMMAND_CATEGORY_CONTENT_PATH_PROPERTIES: readonly CommandCategoryContentPathProperties[] = [
  {
    commandCategory: CommandCategory.Create,
    excludePathsPropertyName: 'createExcludePaths',
    includePathsPropertyName: 'createIncludePaths'
  },
  {
    commandCategory: CommandCategory.Merge,
    excludePathsPropertyName: 'mergeExcludePaths',
    includePathsPropertyName: 'mergeIncludePaths'
  },
  {
    commandCategory: CommandCategory.MoveAndFlatten,
    excludePathsPropertyName: 'moveAndFlattenExcludePaths',
    includePathsPropertyName: 'moveAndFlattenIncludePaths'
  },
  {
    commandCategory: CommandCategory.Rename,
    excludePathsPropertyName: 'renameExcludePaths',
    includePathsPropertyName: 'renameIncludePaths'
  },
  {
    commandCategory: CommandCategory.Reorder,
    excludePathsPropertyName: 'reorderExcludePaths',
    includePathsPropertyName: 'reorderIncludePaths'
  },
  {
    commandCategory: CommandCategory.SmartCutAndPaste,
    excludePathsPropertyName: 'smartCutAndPasteExcludePaths',
    includePathsPropertyName: 'smartCutAndPasteIncludePaths'
  },
  {
    commandCategory: CommandCategory.SplitAndExtract,
    excludePathsPropertyName: 'splitExcludePaths',
    includePathsPropertyName: 'splitIncludePaths'
  },
  {
    commandCategory: CommandCategory.Swap,
    excludePathsPropertyName: 'swapExcludePaths',
    includePathsPropertyName: 'swapIncludePaths'
  }
];

describe('Action enum', () => {
  it('should have Merge value', () => {
    expect(Action.Merge).toBe('Merge');
  });

  it('should have Split value', () => {
    expect(Action.Split).toBe('Split');
  });
});

describe('CommandCategory enum', () => {
  // The values double as the settings-tab group headings and as the wording the demo vault uses, so they
  // Are asserted literally rather than compared to each other (issue #249).
  it('should have Create value', () => {
    expect(CommandCategory.Create).toBe('Create');
  });

  it('should have Merge value', () => {
    expect(CommandCategory.Merge).toBe('Merge');
  });

  it('should have MoveAndFlatten value', () => {
    expect(CommandCategory.MoveAndFlatten).toBe('Move/flatten');
  });

  it('should have Rename value', () => {
    expect(CommandCategory.Rename).toBe('Rename');
  });

  it('should have Reorder value', () => {
    expect(CommandCategory.Reorder).toBe('Reorder');
  });

  it('should have Select value', () => {
    expect(CommandCategory.Select).toBe('Select');
  });

  it('should have SmartCutAndPaste value', () => {
    expect(CommandCategory.SmartCutAndPaste).toBe('Smart cut & paste');
  });

  it('should have SplitAndExtract value', () => {
    expect(CommandCategory.SplitAndExtract).toBe('Split/extract');
  });

  it('should have Swap value', () => {
    expect(CommandCategory.Swap).toBe('Swap');
  });
});

describe('COMMAND_CATEGORIES', () => {
  // The list is spelled out, so this is what catches a category added to the enum without a place in the
  // Settings tab, the settings that back it, and the table below.
  it('should list every CommandCategory member exactly once', () => {
    const enumValues = Object.keys(CommandCategory).map((key) => getEnumValue(CommandCategory, key));
    expect([...COMMAND_CATEGORIES].sort()).toEqual(enumValues.sort());
  });

  it('should have one settings pair per category', () => {
    expect(COMMAND_CATEGORY_PATH_PROPERTIES.map((properties) => properties.commandCategory).sort()).toEqual([...COMMAND_CATEGORIES].sort());
  });

  it('should have one content settings pair per category except Select', () => {
    const categoriesWithContentPair = COMMAND_CATEGORY_CONTENT_PATH_PROPERTIES.map((properties) => properties.commandCategory).sort();
    expect(categoriesWithContentPair).toEqual(COMMAND_CATEGORIES.filter((commandCategory) => commandCategory !== CommandCategory.Select).sort());
  });
});

describe('COMMAND_MENU_PLACEMENTS', () => {
  // The list is spelled out, so this is what catches a placement added to the enum and left out of the
  // List the validator checks against — which would make the new member the one value it rejects.
  it('should list every CommandMenuPlacement member exactly once', () => {
    const enumValues = Object.keys(CommandMenuPlacement).map((key) => getEnumValue(CommandMenuPlacement, key));
    expect([...COMMAND_MENU_PLACEMENTS].sort()).toEqual(enumValues.sort());
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
    // Every per-category pair starts empty too (issue #249), so an existing vault that only ever set the
    // Two lists above keeps behaving exactly as it did — which is why the feature needs no converter.
    for (const { excludePathsPropertyName, includePathsPropertyName } of COMMAND_CATEGORY_PATH_PROPERTIES) {
      expect(settings[excludePathsPropertyName]).toEqual([]);
      expect(settings[includePathsPropertyName]).toEqual([]);
    }
    expect(settings.defaultFrontmatterMergeStrategy).toBe(FrontmatterMergeStrategy.MergeAndPreferNewValues);
    // `Create` is the common extract-to-a-new-note case and what the picker did before the switch existed
    // Whenever the typed name matched nothing (issue #227), so the new key needs no legacy converter.
    expect(settings.defaultSplitTargetMode).toBe(SplitTargetMode.Create);
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
    expect(settings.isPathIgnored('secret/file.md', CommandCategory.Merge)).toBe(true);
  });

  it('should not ignore paths that are not excluded', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['secret'];
    expect(settings.isPathIgnored('public/file.md', CommandCategory.Merge)).toBe(false);
  });

  it('should include all paths when includePaths is empty', () => {
    const settings = new PluginSettings();
    expect(settings.isPathIgnored('anything/file.md', CommandCategory.Merge)).toBe(false);
  });

  it('should ignore paths not in includePaths when includePaths is set', () => {
    const settings = new PluginSettings();
    settings.includePaths = ['allowed'];
    expect(settings.isPathIgnored('not-allowed/file.md', CommandCategory.Merge)).toBe(true);
  });

  it('should treat a path string entry as the folder and its entire subtree', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['Inbox'];
    expect(settings.isPathIgnored('Inbox', CommandCategory.Merge)).toBe(true);
    expect(settings.isPathIgnored('Inbox/note.md', CommandCategory.Merge)).toBe(true);
    expect(settings.isPathIgnored('Inbox/sub/deep.md', CommandCategory.Merge)).toBe(true);
    expect(settings.isPathIgnored('Other/note.md', CommandCategory.Merge)).toBe(false);
  });

  it('should match only the folder itself for a regular expression entry anchored to it', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['/^Inbox$/'];
    expect(settings.isPathIgnored('Inbox', CommandCategory.Merge)).toBe(true);
    expect(settings.isPathIgnored('Inbox/note.md', CommandCategory.Merge)).toBe(false);
    expect(settings.isPathIgnored('Inbox/sub/deep.md', CommandCategory.Merge)).toBe(false);
    expect(settings.isPathIgnored('Other/note.md', CommandCategory.Merge)).toBe(false);
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
    expect(settings.shouldBlockCommandOnPath('secret/file.md', CommandCategory.Merge)).toBe(true);
  });

  it('should not block a path outside commandExcludePaths', () => {
    const settings = new PluginSettings();
    settings.commandExcludePaths = ['secret'];
    expect(settings.shouldBlockCommandOnPath('public/file.md', CommandCategory.Merge)).toBe(false);
  });

  it('should block a path outside commandIncludePaths when it is set', () => {
    const settings = new PluginSettings();
    settings.commandIncludePaths = ['allowed'];
    expect(settings.shouldBlockCommandOnPath('elsewhere/file.md', CommandCategory.Merge)).toBe(true);
    expect(settings.shouldBlockCommandOnPath('allowed/file.md', CommandCategory.Merge)).toBe(false);
  });

  it('should block nothing when both command path lists are empty', () => {
    const settings = new PluginSettings();
    expect(settings.shouldBlockCommandOnPath('anything/file.md', CommandCategory.Merge)).toBe(false);
  });

  // Issue #198's actual ask: a path excluded from merges/splits keeps its commands unless it is ALSO
  // Listed in the command filter. Before the split, `excludePaths` alone could hide them.
  it('should not block a path that is only in excludePaths', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['secret'];
    expect(settings.shouldBlockCommandOnPath('secret/file.md', CommandCategory.Merge)).toBe(false);
  });

  it('should not be affected by includePaths', () => {
    const settings = new PluginSettings();
    settings.includePaths = ['allowed'];
    expect(settings.shouldBlockCommandOnPath('elsewhere/file.md', CommandCategory.Merge)).toBe(false);
  });

  // The pair without a category prefix is the baseline that still means EVERY command (issue #249) — it
  // Is what an existing `data.json` carries, and why the change needs no legacy converter.
  it('should block every category from the un-prefixed command path lists', () => {
    const settings = new PluginSettings();
    settings.commandExcludePaths = ['secret'];
    for (const commandCategory of COMMAND_CATEGORIES) {
      expect(settings.shouldBlockCommandOnPath('secret/file.md', commandCategory)).toBe(true);
    }
  });
});

describe('PluginSettings per-category command path lists (issue #249)', () => {
  it.each(COMMAND_CATEGORY_PATH_PROPERTIES)(
    'should get and set the $commandCategory lists',
    ({ excludePathsPropertyName, includePathsPropertyName }) => {
      const settings = new PluginSettings();
      settings[includePathsPropertyName] = ['allowed'];
      settings[excludePathsPropertyName] = ['blocked'];
      expect(settings[includePathsPropertyName]).toEqual(['allowed']);
      expect(settings[excludePathsPropertyName]).toEqual(['blocked']);
    }
  );

  it.each(COMMAND_CATEGORY_PATH_PROPERTIES)(
    'should block only $commandCategory when its exclude list names the path',
    ({ commandCategory, excludePathsPropertyName }) => {
      const settings = new PluginSettings();
      settings[excludePathsPropertyName] = ['secret'];
      for (const otherCommandCategory of COMMAND_CATEGORIES) {
        expect(settings.shouldBlockCommandOnPath('secret/file.md', otherCommandCategory)).toBe(otherCommandCategory === commandCategory);
      }
      expect(settings.shouldBlockCommandOnPath('public/file.md', commandCategory)).toBe(false);
    }
  );

  it.each(COMMAND_CATEGORY_PATH_PROPERTIES)(
    'should restrict only $commandCategory when its include list is set',
    ({ commandCategory, includePathsPropertyName }) => {
      const settings = new PluginSettings();
      settings[includePathsPropertyName] = ['allowed'];
      for (const otherCommandCategory of COMMAND_CATEGORIES) {
        expect(settings.shouldBlockCommandOnPath('elsewhere/file.md', otherCommandCategory)).toBe(otherCommandCategory === commandCategory);
      }
      expect(settings.shouldBlockCommandOnPath('allowed/file.md', commandCategory)).toBe(false);
    }
  );

  it('should block nothing while every category list is empty', () => {
    const settings = new PluginSettings();
    for (const commandCategory of COMMAND_CATEGORIES) {
      expect(settings.shouldBlockCommandOnPath('anything/file.md', commandCategory)).toBe(false);
    }
  });

  // The reporter's first example (issue #249): block merges on a path and keep everything else there.
  it('should hide one category on a path while the others stay offered', () => {
    const settings = new PluginSettings();
    settings.mergeCommandExcludePaths = ['Journal'];
    expect(settings.shouldBlockCommandOnPath('Journal/note.md', CommandCategory.Merge)).toBe(true);
    expect(settings.shouldBlockCommandOnPath('Journal/note.md', CommandCategory.Reorder)).toBe(false);
    expect(settings.shouldBlockCommandOnPath('Journal/note.md', CommandCategory.Rename)).toBe(false);
  });

  // The reporter's third example: block everything on a path except one category, spelled as the other
  // Eight exclude lists. There is deliberately no allow-back over the un-prefixed pair — a category list
  // Can only narrow further, never re-open what the baseline already hid.
  it('should leave exactly one category offered when the other eight exclude the path', () => {
    const settings = new PluginSettings();
    for (const { commandCategory, excludePathsPropertyName } of COMMAND_CATEGORY_PATH_PROPERTIES) {
      if (commandCategory === CommandCategory.Rename) {
        continue;
      }
      settings[excludePathsPropertyName] = ['Archive'];
    }

    for (const commandCategory of COMMAND_CATEGORIES) {
      expect(settings.shouldBlockCommandOnPath('Archive/note.md', commandCategory)).toBe(commandCategory !== CommandCategory.Rename);
    }
  });

  it('should keep a category list independent of the content filter', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['ignored'];
    expect(settings.shouldBlockCommandOnPath('ignored/file.md', CommandCategory.Merge)).toBe(false);
    expect(settings.mergeCommandExcludePaths).toEqual([]);
  });
});

describe('PluginSettings per-category content path lists (issue #270)', () => {
  it.each(COMMAND_CATEGORY_CONTENT_PATH_PROPERTIES)(
    'should get and set the $commandCategory lists',
    ({ excludePathsPropertyName, includePathsPropertyName }) => {
      const settings = new PluginSettings();
      settings[includePathsPropertyName] = ['allowed'];
      settings[excludePathsPropertyName] = ['blocked'];
      expect(settings[includePathsPropertyName]).toEqual(['allowed']);
      expect(settings[excludePathsPropertyName]).toEqual(['blocked']);
    }
  );

  it.each(COMMAND_CATEGORY_CONTENT_PATH_PROPERTIES)(
    'should ignore the path for $commandCategory only when its exclude list names it',
    ({ commandCategory, excludePathsPropertyName }) => {
      const settings = new PluginSettings();
      settings[excludePathsPropertyName] = ['secret'];
      for (const otherCommandCategory of COMMAND_CATEGORIES) {
        expect(settings.isPathIgnored('secret/file.md', otherCommandCategory)).toBe(otherCommandCategory === commandCategory);
      }
      expect(settings.isPathIgnored('public/file.md', commandCategory)).toBe(false);
    }
  );

  it.each(COMMAND_CATEGORY_CONTENT_PATH_PROPERTIES)(
    'should restrict only $commandCategory when its include list is set',
    ({ commandCategory, includePathsPropertyName }) => {
      const settings = new PluginSettings();
      settings[includePathsPropertyName] = ['allowed'];
      for (const otherCommandCategory of COMMAND_CATEGORIES) {
        expect(settings.isPathIgnored('elsewhere/file.md', otherCommandCategory)).toBe(otherCommandCategory === commandCategory);
      }
      expect(settings.isPathIgnored('allowed/file.md', commandCategory)).toBe(false);
    }
  );

  it('should ignore nothing while every category list is empty', () => {
    const settings = new PluginSettings();
    for (const commandCategory of COMMAND_CATEGORIES) {
      expect(settings.isPathIgnored('anything/file.md', commandCategory)).toBe(false);
    }
  });

  // The un-prefixed pair is the baseline that still means EVERY command — it is what an existing
  // `data.json` carries, and why the change needs no legacy converter.
  it('should ignore the path for every category from the un-prefixed content path lists', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['secret'];
    for (const commandCategory of COMMAND_CATEGORIES) {
      expect(settings.isPathIgnored('secret/file.md', commandCategory)).toBe(true);
    }
  });

  // The reporter's own case (issue #270): the templates folder must stay out of the reorder modal while
  // Every other command keeps working on it. This is the assertion that would fail with #249's
  // Per-category pair, which only hides commands.
  it('should exclude a folder from one category while the others still use it', () => {
    const settings = new PluginSettings();
    settings.reorderExcludePaths = ['Templates'];
    expect(settings.isPathIgnored('Templates/daily.md', CommandCategory.Reorder)).toBe(true);
    expect(settings.isPathIgnored('Templates/daily.md', CommandCategory.Merge)).toBe(false);
    expect(settings.isPathIgnored('Templates/daily.md', CommandCategory.SplitAndExtract)).toBe(false);
    expect(settings.isPathIgnored('Templates/daily.md', CommandCategory.Rename)).toBe(false);
  });

  // A category narrows, it never re-opens: the baseline exclusion wins even where a category's include
  // List names the same path.
  it('should keep a category include list from re-opening a baseline-excluded path', () => {
    const settings = new PluginSettings();
    settings.excludePaths = ['Archive'];
    settings.mergeIncludePaths = ['Archive'];
    expect(settings.isPathIgnored('Archive/note.md', CommandCategory.Merge)).toBe(true);
  });

  it('should leave exactly one category using the path when every other category with a pair excludes it', () => {
    const settings = new PluginSettings();
    for (const { commandCategory, excludePathsPropertyName } of COMMAND_CATEGORY_CONTENT_PATH_PROPERTIES) {
      if (commandCategory === CommandCategory.Rename) {
        continue;
      }
      settings[excludePathsPropertyName] = ['Archive'];
    }

    for (const commandCategory of COMMAND_CATEGORIES) {
      // `Select` joins `Rename` on the allowed side because it has no exclude list to have been set.
      const isExcluded = commandCategory !== CommandCategory.Rename && commandCategory !== CommandCategory.Select;
      expect(settings.isPathIgnored('Archive/note.md', commandCategory)).toBe(isExcluded);
    }
  });

  // `Select` has no content pair, so it must still be ANSWERABLE — from the baseline pair alone — rather
  // Than throwing on a missing map entry. This is what keeps `isPathIgnored` total over the enum.
  it('should answer for Select from the baseline pair alone', () => {
    const settings = new PluginSettings();
    expect(settings.isPathIgnored('anywhere/note.md', CommandCategory.Select)).toBe(false);
    settings.excludePaths = ['Archive'];
    expect(settings.isPathIgnored('Archive/note.md', CommandCategory.Select)).toBe(true);
    expect(settings.isPathIgnored('Other/note.md', CommandCategory.Select)).toBe(false);
  });

  // The two filters stay apart: excluding a path from a category's CONTENT does not hide its commands
  // There, which is the whole point of #198 having split them.
  it('should keep a content list independent of the command-visibility filter', () => {
    const settings = new PluginSettings();
    settings.reorderExcludePaths = ['Templates'];
    expect(settings.shouldBlockCommandOnPath('Templates/daily.md', CommandCategory.Reorder)).toBe(false);
    expect(settings.reorderCommandExcludePaths).toEqual([]);
  });
});
