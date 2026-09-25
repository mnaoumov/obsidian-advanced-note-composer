import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { normalizePath } from 'obsidian';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import {
  parseFrontmatter,
  setFrontmatter
} from 'obsidian-dev-utils/obsidian/frontmatter';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';
import {
  basename,
  join
} from 'obsidian-dev-utils/path';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { CreateFolderTemplateTokens } from '../template-tokens.ts';

import { getAvailableFolderPath } from '../available-folder-path.ts';
import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { swapDerivedAlias } from '../folder-note-aliases.ts';
import {
  resolveFolderNoteConfigFromSettings,
  resolveFolderNoteFromSettings
} from '../folder-note.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { parseNumberedName } from '../numbered-name.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import { CommandCategory } from '../plugin-settings.ts';
import { recordRecentTarget } from '../recent-targets.ts';
import {
  BASE_TOKEN_KEYS,
  ReorderItemKind
} from '../reorder-items.ts';
import { resolveCreateFolderTemplateTokens } from '../template-tokens.ts';
import {
  renderSingleLineValueWithTemplater,
  TemplateRenderError
} from '../templater-string.ts';
import {
  normalizeTypedFolderNameWithTransform,
  validateTypedFolderName
} from '../typed-folder-name.ts';

const FOLDER_NOTE_ALIASES_TEMPLATE_SETTING_NAME = 'Folder note aliases template';
const FOLDER_NOTE_TITLE_TEMPLATE_SETTING_NAME = 'Folder note title template';

/**
 * Parameters for {@link RenameFolderCommandHandler}.
 */
export interface RenameFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface BuildTokensParams {
  readonly folderName: string;
  readonly folderPath: string;
  readonly index: number;
  readonly parentFolder: TFolder;
  readonly safeFolderName: string;
}

/**
 * One rename, fully decided: where the folder is now, where it is going, and the token bags the folder
 * note's properties are rendered from on each side of it.
 */
interface RenamePlan {
  readonly newFolderPath: string;
  readonly newTokens: CreateFolderTemplateTokens;
  readonly oldFolderPath: string;
  readonly oldTokens: CreateFolderTemplateTokens;
}

interface RenderTemplateParams {
  readonly app: App;

  /**
   * The folder note the value is written into — what `tp.file.*` reports on.
   */
  readonly noteFile: TFile;

  /**
   * The setting's display name, for a refusal to point at.
   */
  readonly settingName: string;

  readonly template: string;
  readonly tokens: CreateFolderTemplateTokens;
}

const ALIASES_PROPERTY_NAME = 'aliases';

/**
 * What `{{index}}` renders to for a folder whose name carries no index. `0` rather than an empty string
 * because the token is a number everywhere else, and a folder outside the numbering has no position in it.
 */
const NO_INDEX = 0;

const TITLE_PROPERTY_NAME = 'title';

/**
 * `Rename folder...` command (issue #217): renames a folder and, in the same reversible transaction, keeps
 * its FOLDER NOTE in step — the note's own file name, its `title` and its `aliases`.
 *
 * The folder note is the whole scope, deliberately. The reporter first asked for "its direct note" and then
 * for "any note within the folder, and not in subfolders"; rewriting the `title` of every note that happens
 * to sit in a folder would be rewriting notes that never claimed to describe it. What describes a folder is
 * its folder note, which is exactly what {@link resolveFolderNote} already answers for `Reorder`.
 *
 * The folder's INDEX survives the rename. The prompt is seeded with the name WITHOUT its number, so renaming
 * `1. Alpha` to `Beta` yields `1. Beta` and a folder never silently leaves the sequence it is numbered into;
 * a folder that never had a number simply takes the typed name.
 */
export class RenameFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: RenameFolderCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-pencil',
      id: 'rename-folder',
      name: 'Rename folder...'
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    return !folder.isRoot() && !isFileOrFolderCommandBlocked({ abstractFile: folder, commandCategory: CommandCategory.Rename, pluginSettingsComponent: this.pluginSettingsComponent });
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    // Non-null by `canExecuteFolder`, which refuses the vault root — the only folder without a parent.
    const parentFolder = ensureNonNullable(folder.parent);

    const plan = await this.buildPlan(folder, parentFolder);
    if (!plan || !await this.rename(folder, plan)) {
      return;
    }

    recordRecentTarget(parentFolder);
    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        shouldLinkSource: false,
        sourcePathOrAbstractFile: plan.oldFolderPath,
        targetPathOrAbstractFile: plan.newFolderPath,
        verb: 'Renamed folder'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFolderMenu(params: FolderCommandHandlerShouldAddToFolderMenuParams): boolean {
    super.shouldAddToFolderMenu(params);
    return true;
  }

  /**
   * Asks for the new name and works out everything the rename needs, without touching the vault.
   *
   * @param folder - The folder being renamed.
   * @param parentFolder - The folder holding it.
   * @returns The plan, or `null` when the prompt was cancelled or the name did not actually change.
   */
  private async buildPlan(folder: TFolder, parentFolder: TFolder): Promise<null | RenamePlan> {
    const settings = this.pluginSettingsComponent.settings;
    const nameTemplate = settings.reorderedFolderNameTemplate;
    const baseTokenKey = BASE_TOKEN_KEYS[ReorderItemKind.Folder];

    const parsedOldName = parseNumberedName({ baseTokenKey, name: folder.name, nameTemplate });

    const rawTypedName = await prompt({
      app: this.app,
      cancelButtonText: 'Cancel',
      // Seeded WITHOUT the index: the number belongs to the sequence, not to something retyped by hand.
      defaultValue: parsedOldName.baseName,
      okButtonText: 'Rename',
      placeholder: 'Folder name',
      title: 'Rename folder',
      valueValidator: async (value: string): Promise<MaybeReturn<string>> => await this.validateTypedName(value)
    });
    if (rawTypedName === null) {
      return null;
    }

    // Cannot throw: the prompt's validator already ran the same transform over the same text.
    const safeFolderName = await this.normalizeTypedName(rawTypedName);
    const requestedFolderName = parsedOldName.index === null
      ? safeFolderName
      // The folder keeps the number it already had, rendered through the very template that reads it back,
      // so the separator and the padding follow the vault's own scheme rather than being reassembled here.
      : resolveCreateFolderTemplateTokens({
        template: nameTemplate,
        tokens: buildTokens({
          folderName: '',
          folderPath: '',
          index: parsedOldName.index,
          parentFolder,
          safeFolderName
        })
      }).trim();

    if (requestedFolderName === folder.name) {
      return null;
    }

    const newFolderPath = getAvailableFolderPath(this.app, normalizePath(join(parentFolder.path, requestedFolderName)));
    // Read back off the PATH rather than trusting the requested name: a sibling already called that makes
    // `getAvailableFolderPath` hand back `Beta 1`, and the properties must describe the folder that will
    // actually exist.
    const newFolderName = basename(newFolderPath);
    const parsedNewName = parseNumberedName({ baseTokenKey, name: newFolderName, nameTemplate });

    return {
      newFolderPath,
      newTokens: buildTokens({
        folderName: newFolderName,
        folderPath: newFolderPath,
        index: parsedNewName.index ?? NO_INDEX,
        parentFolder,
        safeFolderName: parsedNewName.baseName
      }),
      oldFolderPath: folder.path,
      oldTokens: buildTokens({
        folderName: folder.name,
        folderPath: folder.path,
        index: parsedOldName.index ?? NO_INDEX,
        parentFolder,
        safeFolderName: parsedOldName.baseName
      })
    };
  }

  /**
   * Applies the same normalization the prompt validated with, so the name that was accepted and the name the
   * folder is renamed to can never diverge.
   *
   * @param rawName - The name as typed.
   * @returns The normalized name.
   */
  private async normalizeTypedName(rawName: string): Promise<string> {
    return await normalizeTypedFolderNameWithTransform({
      app: this.app,
      rawName,
      settings: this.pluginSettingsComponent.settings,
      // Deliberately NOT `shouldTitleCaseCreatedFolderName`: this prompt is seeded with the folder's
      // EXISTING name, so title-casing would re-case a name the user never retyped — merely confirming the
      // dialog would turn `iOS` into `Ios`.
      shouldTitleCase: false
    });
  }

  /**
   * Renames the folder, its folder note and that note's properties in one reversible transaction.
   *
   * @param folder - The folder being renamed. The LIVE object: Obsidian renames in place, so this same
   * instance reports the NEW name once the rename has run.
   * @param plan - What it is being renamed to.
   * @returns Whether the rename ran to completion — `false` when it was cancelled and rolled back.
   */
  private async rename(folder: TFolder, plan: RenamePlan): Promise<boolean> {
    const abortController = new AbortController();
    const progressNotice = showOperationProgressNotice({
      abortController,
      app: this.app,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          pluginSettingsComponent: this.pluginSettingsComponent,
          sourcePathOrAbstractFile: plan.oldFolderPath,
          targetPathOrAbstractFile: plan.newFolderPath,
          verb: 'Renaming folder'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });

    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          // Captured BEFORE the rename: a folder note named after its folder can only be found under the
          // folder's OLD name.
          const folderNote = this.resolveFolderNote(folder);

          await vaultTransaction.rename(folder, plan.newFolderPath);

          if (folderNote) {
            await this.renameFolderNote(folder, folderNote, vaultTransaction);
          }
          await this.writeProperties(folder, plan, vaultTransaction);
        },
        lockTargets: [{ mode: 'subtree', pathOrFile: plan.oldFolderPath }],
        operationName: 'Rename folder',
        resourceLockComponent: this.resourceLockComponent
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return false;
      }
      if (error instanceof TemplateRenderError) {
        // A misconfigured property template (issue #284): the transaction has rolled the rename back, and the
        // message names the setting to fix. Anything else is a genuine bug and still reaches the handler.
        this.pluginNoticeComponent.showNotice(error.message);
        return false;
      }
      throw error;
    } finally {
      progressNotice?.[Symbol.dispose]();
    }

    return true;
  }

  /**
   * Renames the folder note so it keeps BEING this folder's folder note.
   *
   * Only matters where the folder-note name is derived from the folder's own name (`{{folderName}}`, the
   * commonest layout and the `Auto` fallback): renaming `Alpha` to `Beta` would otherwise leave its note
   * called `Alpha.md`, which by that very rule is no longer a folder note — the rename would quietly
   * dissolve the relationship it exists to maintain. A fixed name (`!`, `index`) resolves to the same name
   * before and after, so nothing happens.
   *
   * Skipped when the note has already moved itself: with `Folder notes` installed and `syncFolderName` on,
   * that plugin renames it as soon as the folder is renamed, and it is already where it belongs.
   *
   * @param folder - The folder, already carrying its NEW name.
   * @param folderNote - The note, captured before the rename.
   * @param vaultTransaction - The transaction owning the operation.
   */
  private async renameFolderNote(folder: TFolder, folderNote: TFile, vaultTransaction: VaultTransaction): Promise<void> {
    const config = resolveFolderNoteConfigFromSettings({
      app: this.app,
      settings: this.pluginSettingsComponent.settings
    });

    // The note's own path is LIVE: an inside-the-folder note moved with its folder's rename, and a
    // `Folder notes` install with `syncFolderName` on may already have renamed it outright.
    const noteParentPath = ensureNonNullable(folderNote.parent).path;
    // Never empty: the note was found because this same name resolved to one, and the only token it can
    // carry is the folder's own name.
    const newNoteName = config.resolveName(folder).trim();
    const newNotePath = normalizePath(join(noteParentPath, `${newNoteName}.${folderNote.extension}`));
    if (newNotePath === folderNote.path) {
      return;
    }

    await vaultTransaction.rename(folderNote, newNotePath);
  }

  /**
   * Finds this folder's folder note under the folder's CURRENT name.
   *
   * @param folder - The folder.
   * @returns The note, or `null` when this folder has none (or this vault has no folder notes at all).
   */
  private resolveFolderNote(folder: TFolder): null | TFile {
    return resolveFolderNoteFromSettings({
      app: this.app,
      folder,
      settings: this.pluginSettingsComponent.settings
    });
  }

  /**
   * Validates what was typed into the prompt.
   *
   * @param value - The typed name.
   * @returns The error message, or nothing when the name is usable.
   */
  private async validateTypedName(value: string): Promise<MaybeReturn<string>> {
    return await validateTypedFolderName({
      app: this.app,
      rawName: value,
      settings: this.pluginSettingsComponent.settings,
      shouldTitleCase: false
    });
  }

  /**
   * Writes the folder note's `title` and `aliases`.
   *
   * Runs AFTER the renames and re-resolves the folder note from the folder's NEW path, deliberately: with
   * the `Folder notes` plugin installed and its `syncFolderName` on, it renames the folder note itself when
   * the folder is renamed, so a `TFile` captured beforehand would point at a path that no longer exists.
   *
   * Both properties go through the transaction rather than `processFrontMatter`, so a cancelled rename rolls
   * them back together with the names. An empty template is each property's own opt-out, and with both empty
   * the note is not touched at all.
   *
   * @param folder - The folder, already carrying its NEW name.
   * @param plan - The token bags the properties are rendered from.
   * @param vaultTransaction - The transaction owning the operation.
   */
  private async writeProperties(folder: TFolder, plan: RenamePlan, vaultTransaction: VaultTransaction): Promise<void> {
    const noteFile = this.resolveFolderNote(folder);
    if (!noteFile) {
      return;
    }

    const settings = this.pluginSettingsComponent.settings;
    const title = await renderTemplate({
      app: this.app,
      noteFile,
      settingName: FOLDER_NOTE_TITLE_TEMPLATE_SETTING_NAME,
      template: settings.folderNoteTitleTemplate,
      tokens: plan.newTokens
    });
    const newAlias = await renderTemplate({
      app: this.app,
      noteFile,
      settingName: FOLDER_NOTE_ALIASES_TEMPLATE_SETTING_NAME,
      template: settings.folderNoteAliasesTemplate,
      tokens: plan.newTokens
    });
    if (!title && !newAlias) {
      return;
    }

    // Rendered with the OLD tokens so the entry it names can be found and swapped out. A template whose
    // templater half is not a function of the tokens (a date, say) renders differently this time, so the old
    // entry is not found and the note simply gains the new one — `swapDerivedAlias`'s safe direction.
    const oldAlias = await renderTemplate({
      app: this.app,
      noteFile,
      settingName: FOLDER_NOTE_ALIASES_TEMPLATE_SETTING_NAME,
      template: settings.folderNoteAliasesTemplate,
      tokens: plan.oldTokens
    });

    await vaultTransaction.process(noteFile, (content) => {
      const frontmatter = parseFrontmatter(content);
      const newFrontmatter: Record<string, unknown> = { ...frontmatter };
      if (title) {
        newFrontmatter[TITLE_PROPERTY_NAME] = title;
      }
      if (newAlias) {
        newFrontmatter[ALIASES_PROPERTY_NAME] = swapDerivedAlias({
          existingAliases: frontmatter[ALIASES_PROPERTY_NAME],
          newAlias,
          oldAlias
        });
      }
      return setFrontmatter(content, newFrontmatter);
    });
  }
}

/**
 * Builds the token bag a folder-flavored template is rendered from.
 *
 * @param params - The values that differ between the two sides of a rename.
 * @returns The bag.
 */
function buildTokens(params: BuildTokensParams): CreateFolderTemplateTokens {
  const {
    folderName,
    folderPath,
    index,
    parentFolder,
    safeFolderName
  } = params;

  return {
    folderName,
    folderPath,
    index,
    parentFolder: parentFolder.name,
    parentFolderPath: parentFolder.path,
    // Never read: the settings validators reject `{{rawFolderName}}` in every template rendered here, since
    // A property describing a folder can only meaningfully name what the folder ended up being called.
    rawFolderName: '',
    safeFolderName
  };
}

/**
 * Renders one of the folder note's property templates: the plugin's own `{{tokens}}` first, then Templater
 * when a `<%` survives them (issue #284), with the folder note itself as `tp.file`.
 *
 * @param params - The template, its tokens and the Templater context.
 * @returns The rendered value, or an empty string when the template is empty — the opt-out that leaves the
 * property alone.
 */
async function renderTemplate(params: RenderTemplateParams): Promise<string> {
  const {
    app,
    noteFile,
    settingName,
    template,
    tokens
  } = params;

  if (!template) {
    return '';
  }

  return await renderSingleLineValueWithTemplater({
    app,
    contextFile: noteFile,
    resolvedTemplate: resolveCreateFolderTemplateTokens({ template, tokens }),
    settingName,
    tokens
  });
}
