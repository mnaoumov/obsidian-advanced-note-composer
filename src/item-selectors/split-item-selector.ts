import type {
  TFile,
  TFolder
} from 'obsidian';

import { normalizePath } from 'obsidian';
import { addAlias } from 'obsidian-dev-utils/obsidian/file-manager';
import { createFolderSafe } from 'obsidian-dev-utils/obsidian/vault';
import { trimEnd } from 'obsidian-dev-utils/string';

import type { Frontmatter } from '../frontmatter-merge.ts';
import type {
  ItemSelectorBaseConstructorParams,
  SelectItemResult
} from './item-selector-base.ts';

import { getAvailableFolderPath } from '../available-folder-path.ts';
import { fixFileName } from '../filename-validation.ts';
import { transformAndFixFileName } from '../name-transform.ts';
import { FrontmatterTitleMode } from '../plugin-settings.ts';
import { resolveTemplateTokens } from '../template-tokens.ts';
import { ItemSelectorBase } from './item-selector-base.ts';

interface SplitItemSelectorConstructorParams extends ItemSelectorBaseConstructorParams {
  readonly shouldAllowOnlyCurrentFolder: boolean;

  /**
   * Puts the new note into its own folder even when the `shouldSplitIntoFolder` setting is off. Set by the
   * recursive split, whose folder tree IS the feature, so it cannot be at the mercy of that setting.
   */
  readonly shouldForceSplitIntoFolder?: boolean;
  readonly shouldTreatTitleAsPath: boolean;

  /**
   * Creates the new note in THIS folder, whatever `shouldAllowOnlyCurrentFolder` would otherwise have
   * resolved to. Set by the recursive split when the user changed the target of its root pass (issue #205),
   * which is the only way to state a destination that is neither "beside the source" nor Obsidian's default
   * new-note location.
   */
  readonly targetParentFolderOverride?: null | TFolder;
}

export class SplitItemSelector extends ItemSelectorBase {
  private readonly shouldAllowOnlyCurrentFolder: boolean;
  private readonly shouldForceSplitIntoFolder: boolean;
  private readonly shouldTreatTitleAsPath: boolean;
  private readonly targetParentFolderOverride: null | TFolder;

  public constructor(params: SplitItemSelectorConstructorParams) {
    super(params);
    this.shouldAllowOnlyCurrentFolder = params.shouldAllowOnlyCurrentFolder;
    this.shouldForceSplitIntoFolder = params.shouldForceSplitIntoFolder ?? false;
    this.shouldTreatTitleAsPath = params.shouldTreatTitleAsPath;
    this.targetParentFolderOverride = params.targetParentFolderOverride ?? null;
  }

  public override async selectItem(): Promise<SelectItemResult> {
    if (this.isModifier || !this.item) {
      const existingFile = this.app.metadataCache.getFirstLinkpathDest(this.inputValue, '');
      if (existingFile && this.pluginSettingsComponent.settings.isPathIgnored(existingFile.path)) {
        return {
          isNewTargetFile: false,
          targetFile: existingFile
        };
      }

      return {
        isNewTargetFile: true,
        targetFile: await this.createNewMarkdownFileFromLinktext(this.inputValue)
      };
    }

    if (this.item.type === 'unresolved') {
      return {
        isNewTargetFile: true,
        targetFile: await this.createNewMarkdownFileFromLinktext(this.item.linktext ?? '')
      };
    }

    if (this.item.type === 'file' || this.item.type === 'alias') {
      if (!this.item.file) {
        throw new Error('File not found');
      }

      return {
        isNewTargetFile: false,
        targetFile: this.item.file
      };
    }

    return {
      isNewTargetFile: true,
      targetFile: await this.createNewMarkdownFileFromLinktext(this.inputValue)
    };
  }

  private async createNewMarkdownFileFromLinktext(fileName: string): Promise<TFile> {
    fileName = trimEnd({ $string: fileName, suffix: '.md' });
    const fixedFileName = `${await this.resolveFileName(fileName)}.md`;
    const prefix = this.resolveTargetFolderPrefix();
    const file = await this.app.fileManager.createNewMarkdownFileFromLinktext(prefix + fixedFileName, this.sourceFile.path);

    const overriddenBasename = this.shouldForceSplitIntoFolder || this.pluginSettingsComponent.settings.shouldSplitIntoFolder
      ? await this.moveIntoOwnFolder(file)
      : null;

    /*
     * A `splitIntoFolderNoteNameTemplate` override renames the note away from the typed name, so the
     * typed name is recorded as an alias / frontmatter title exactly like any other changed title
     * (issue #153) — `Foo/Overview.md` still carries `Foo`, so `[[Foo]]` keeps resolving.
     */
    const isInvalidTitle = (overriddenBasename ?? file.basename) !== fileName;

    if (isInvalidTitle && this.pluginSettingsComponent.settings.shouldAddInvalidTitleToNoteAlias) {
      // The note was just created, so there is no open editor to lock while its alias is added.
      await addAlias({ alias: fileName, app: this.app, pathOrFile: file, resourceLockComponent: null });
    }

    let shouldAddTitleToFrontmatter = false;

    switch (this.pluginSettingsComponent.settings.frontmatterTitleMode) {
      case FrontmatterTitleMode.None: {
        break;
      }
      case FrontmatterTitleMode.UseAlways: {
        shouldAddTitleToFrontmatter = true;
        break;
      }
      case FrontmatterTitleMode.UseForInvalidTitleOnly: {
        shouldAddTitleToFrontmatter = isInvalidTitle;
        break;
      }
      default: {
        throw new Error(`Invalid frontmatter title mode: ${this.pluginSettingsComponent.settings.frontmatterTitleMode as string}`);
      }
    }

    if (shouldAddTitleToFrontmatter) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
        frontmatter.title = fileName;
      });
    }

    return file;
  }

  /**
   * Relocates a freshly-created split/extract note into a brand-new folder named after it, so the note
   * lives at `<dir>/<name>/<name>.md` instead of `<dir>/<name>.md` (issue #79). The folder name is
   * de-duplicated against existing siblings. The note keeps its own base name inside the new folder
   * unless the `splitIntoFolderNoteNameTemplate` setting overrides it (issue #153). The note is
   * brand-new and empty, so the move carries no links or backlinks to fix.
   *
   * @param file - The just-created note to move into its own folder (mutated in place by the rename).
   * @returns The overriding base name the note was given inside the folder, or `null` when it kept the
   * folder's name.
   */
  private async moveIntoOwnFolder(file: TFile): Promise<null | string> {
    const parentPath = file.parent?.path ?? '';
    const originalBasename = file.basename;
    const desiredFolderPath = normalizePath(parentPath ? `${parentPath}/${originalBasename}` : originalBasename);
    const folderPath = getAvailableFolderPath(this.app, desiredFolderPath);
    await createFolderSafe(this.app, folderPath);
    const noteBasename = this.resolveNoteBasenameInOwnFolder(file, folderPath);
    // The folder was just created and is therefore empty, so the note can never collide inside it.
    await this.app.fileManager.renameFile(file, normalizePath(`${folderPath}/${noteBasename}.md`));
    return noteBasename === originalBasename ? null : noteBasename;
  }

  /**
   * Runs the typed target name through the `Name transform template` and then the invalid-character pass
   * (issue #196), in that order. The split's SOURCE note is the Templater context, which is the note the
   * user is actually working on.
   *
   * @param fileName - The name as typed.
   * @returns The transformed, sanitized name.
   */
  private async resolveFileName(fileName: string): Promise<string> {
    const { settings } = this.pluginSettingsComponent;
    return await transformAndFixFileName({
      app: this.app,
      contextFile: this.sourceFile,
      fileName,
      nameTransformTemplate: settings.nameTransformTemplate,
      replacement: settings.replacement,
      shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
      shouldTreatTitleAsPath: this.shouldTreatTitleAsPath
    });
  }

  /**
   * Resolves the base name a split/extract note gets inside its own folder from the
   * `splitIntoFolderNoteNameTemplate` setting (issue #153), so every folder split can produce e.g.
   * `<dir>/<name>/Overview.md`. Tokens are resolved against the note as it exists *before* the move, so
   * `{{newTitle}}` is the folder's name. An empty setting, a template resolving to nothing, or a name
   * that still spans folders after sanitization all fall back to the folder's name (today's behavior).
   *
   * The `Name transform template` deliberately does NOT run here (issue #196): `{{newTitle}}` is the note
   * whose name the transform already produced, so running it again would apply the rewrite twice.
   *
   * The folder-flavored tokens (`{{folderName}}`, `{{index}}`, ... — issue #227) are pointed at
   * `folderPath` explicitly, because at this moment the note has NOT been renamed into that folder yet:
   * left to resolve against the note's own parent they would name the folder ABOVE the one being created,
   * which is never what a note-name template inside it means. `{{parentFolder}}` is deliberately left
   * alone and still names that folder above — it is a shipped token in a shipped template.
   *
   * @param file - The just-created note, before it is moved into its folder.
   * @param folderPath - The folder the note is about to be moved into.
   * @returns The base name to give the note inside its folder, without the `.md` extension.
   */
  private resolveNoteBasenameInOwnFolder(file: TFile, folderPath: string): string {
    const template = this.pluginSettingsComponent.settings.splitIntoFolderNoteNameTemplate;
    if (!template) {
      return file.basename;
    }

    const resolved = resolveTemplateTokens({
      content: '',
      folderNameTemplate: this.pluginSettingsComponent.settings.reorderedFolderNameTemplate,
      folderPath,
      sourceFile: this.sourceFile,
      targetFile: file,
      template
    });

    const noteName = trimEnd({ $string: resolved.trim(), suffix: '.md' }).trim();
    if (!noteName) {
      return file.basename;
    }

    const { settings } = this.pluginSettingsComponent;
    const fixedNoteName = fixFileName({
      fileName: noteName,
      replacement: settings.replacement,
      shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
      shouldTreatTitleAsPath: false
    });
    // Only reachable when `shouldReplaceInvalidTitleCharacters` is off, leaving a separator in place.
    // Renaming into the folder that separator implies would fail, since it does not exist.
    if (fixedNoteName.includes('/') || fixedNoteName.includes('\\')) {
      return file.basename;
    }

    return fixedNoteName;
  }

  /**
   * The linktext prefix that decides which folder the new note is created in.
   *
   * An explicit override wins over everything: it is the only way to name a folder that is neither the
   * source's own (`shouldAllowOnlyCurrentFolder`) nor whatever Obsidian's new-file resolution picks from an
   * empty prefix. Without one, the original two-way choice stands unchanged.
   *
   * @returns The prefix to prepend to the file name, or an empty string to let Obsidian resolve the folder.
   */
  private resolveTargetFolderPrefix(): string {
    if (this.targetParentFolderOverride) {
      return `/${this.targetParentFolderOverride.getParentPrefix()}`;
    }
    return this.shouldAllowOnlyCurrentFolder ? `/${this.sourceFile.parent?.getParentPrefix() ?? ''}` : '';
  }
}
