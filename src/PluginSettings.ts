import { escapeRegExp } from 'obsidian-dev-utils/RegExp';

const ALWAYS_MATCH_REG_EXP = /(?:)/;
const NEVER_MATCH_REG_EXP = /$./;

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

export enum TextAfterExtractionMode {
  EmbedNewFile = 'embed',
  LinkToNewFile = 'link',
  None = 'none'
}

export class PluginSettings {
  public defaultFrontmatterMergeStrategy = FrontmatterMergeStrategy.MergeAndPreferNewValues;
  public mergeTemplate = '\n\n{{content}}';
  public releaseNotesShown: readonly string[] = [];
  public replacement = '_';
  public shouldAddInvalidTitleToFrontmatterTitleKey = true;
  public shouldAddInvalidTitleToNoteAlias = true;
  public shouldAllowOnlyCurrentFolderByDefault = false;
  public shouldAllowSplitIntoUnresolvedPathByDefault = true;
  public shouldAskBeforeMerging = true;
  public shouldFixFootnotesByDefault = true;
  public shouldIncludeFrontmatterWhenSplittingByDefault = false;
  public shouldKeepHeadingsWhenSplittingContent = true;
  public shouldMergeHeadingsByDefault = false;
  public shouldOpenNoteAfterMerge = false;
  public shouldReplaceInvalidTitleCharacters = true;
  public shouldRunTemplaterOnDestinationFile = false;
  public shouldTreatTitleAsPathByDefault = true;
  public splitTemplate = '';
  public textAfterExtractionMode = TextAfterExtractionMode.LinkToNewFile;
  public get excludePaths(): string[] {
    return this._excludePaths;
  }

  public set excludePaths(value: string[]) {
    this._excludePaths = value.filter(Boolean);
    this._excludePathsRegExp = makeRegExp(this._excludePaths, NEVER_MATCH_REG_EXP);
  }

  public get includePaths(): string[] {
    return this._includePaths;
  }

  public set includePaths(value: string[]) {
    this._includePaths = value.filter(Boolean);
    this._includePathsRegExp = makeRegExp(this._includePaths, ALWAYS_MATCH_REG_EXP);
  }

  private _excludePaths: string[] = [];
  private _excludePathsRegExp = NEVER_MATCH_REG_EXP;
  private _includePaths: string[] = [];
  private _includePathsRegExp = ALWAYS_MATCH_REG_EXP;

  public isPathIgnored(path: string): boolean {
    return !this._includePathsRegExp.test(path) || this._excludePathsRegExp.test(path);
  }
}

function makeRegExp(paths: string[], defaultRegExp: RegExp): RegExp {
  if (paths.length === 0) {
    return defaultRegExp;
  }

  const regExpStrCombined = paths.map((path) => {
    if (path === '/') {
      return defaultRegExp.source;
    }

    if (path.startsWith('/') && path.endsWith('/')) {
      return path.slice(1, -1);
    }

    if (path.endsWith('/')) {
      return `^${escapeRegExp(path)}`;
    }

    return `^${escapeRegExp(path)}(/|$)`;
  })
    .map((regExpStr) => `(${regExpStr})`)
    .join('|');
  return new RegExp(regExpStrCombined);
}
