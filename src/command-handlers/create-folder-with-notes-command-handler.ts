import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { normalizePath } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';
import { getAvailablePath } from 'obsidian-dev-utils/obsidian/vault';
import {
  basename,
  join
} from 'obsidian-dev-utils/path';

import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { CreateFolderTemplateTokens } from '../template-tokens.ts';

import { getAvailableFolderPath } from '../available-folder-path.ts';
import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { normalizeTypedFolderName } from '../create-folder-name.ts';
import { INVALID_CHARACTERS_REG_EXP } from '../filename-validation.ts';
import { parseFolderContentTemplate } from '../folder-content-template.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { ConfirmDialogModal } from '../modals/confirm-dialog-modal.ts';
import { selectParentFolderForCreate } from '../modals/create-folder-parent-modal.ts';
import { resolveNextFolderIndex } from '../next-folder-index.ts';
import { openModal } from '../open-minimizable-modal.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import { resolveCreateFolderTemplateTokens } from '../template-tokens.ts';
import { insertTemplaterPrelude } from '../templater-prelude.ts';

interface BuildCreateConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly notes: readonly PlannedNote[];
  readonly parentFolder: TFolder;
  readonly tokens: CreateFolderTemplateTokens;
}

interface CreateFolderWithNotesCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * A note the content template declared, with its name and content already resolved — everything needed to
 * write it, decided BEFORE the transaction opens so the confirmation dialog and the write cannot disagree.
 */
interface PlannedNote {
  readonly content: string;
  readonly name: string;
}

const MARKDOWN_EXTENSION = '.md';

interface CreateFolderWithNotesCommandHandlerConfirmCreateParams {
  readonly notes: readonly PlannedNote[];
  readonly parentFolder: TFolder;
  readonly tokens: CreateFolderTemplateTokens;
}

interface CreateFolderWithNotesCommandHandlerCreateFolderWithNotesParams {
  readonly folderPath: string;
  readonly notes: readonly PlannedNote[];
  readonly parentFolder: TFolder;
}

/**
 * `Create folder with notes...` command (issue #191): prompts for a folder name, normalizes it, numbers it
 * after its siblings, creates the folder, and fills it with the notes the content template declares.
 *
 * The whole shape is taken from the reporter's own `folder-note-extended` plugin, which shipped in the
 * issue's sample vault and is the only complete statement of the behavior they wanted. What differs is that
 * their hard-coded decisions are templates here: the `N. ` prefix is `newFolderNameTemplate`, and their
 * fixed `!.md` note with its frontmatter is `newFolderContentTemplate`. That is what lets one command
 * serve their layout and everyone else's without a setting per decision.
 *
 * Registered as a {@link FolderCommandHandler} for the folder menu, where the right-clicked folder is the
 * parent. The command palette needs a different answer — see {@link CreateFolderWithNotesCommandHandler.execute}.
 */
export class CreateFolderWithNotesCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: CreateFolderWithNotesCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-folder-plus',
      id: 'create-folder-with-notes',
      name: 'Create folder with notes...'
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  /**
   * Unlike every other folder command, this one needs no folder to already be in play — it CREATES one. The
   * base would hide it from the palette whenever no note is open, because it resolves the active file's
   * parent as its subject.
   *
   * @returns Always `true`.
   */
  protected override canExecute(): boolean {
    return true;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    return !isFileOrFolderCommandBlocked(this.pluginSettingsComponent, folder);
  }

  /**
   * The command-palette path. The base resolves the active note's parent folder, which is a guess — so this
   * asks instead, then hands the answer to the same {@link CreateFolderWithNotesCommandHandler.executeFolder}
   * the folder menu uses.
   *
   * @returns A {@link Promise} that resolves when the folder has been created or the picker was dismissed.
   */
  protected override async execute(): Promise<void> {
    const parentFolder = await selectParentFolderForCreate({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
    if (!parentFolder) {
      return;
    }

    await this.executeFolder(parentFolder);
  }

  protected override async executeFolder(parentFolder: TFolder): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(parentFolder.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot create a folder in ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: parentFolder }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const rawFolderName = await this.promptForFolderName();
    if (rawFolderName === null) {
      return;
    }

    const settings = this.pluginSettingsComponent.settings;
    const safeFolderName = this.normalizeFolderName(rawFolderName);
    const index = resolveNextFolderIndex({
      nameTemplate: settings.newFolderNameTemplate,
      parentFolder
    });

    // Resolved WITHOUT the folder tokens: this is the template that produces them. The settings validator
    // Rejects `{{folderName}}` / `{{folderPath}}` here, so nothing can silently render as nothing.
    const desiredFolderName = resolveCreateFolderTemplateTokens({
      template: settings.newFolderNameTemplate,
      tokens: {
        folderName: '',
        folderPath: '',
        index,
        parentFolder: parentFolder.name,
        parentFolderPath: parentFolder.path,
        rawFolderName,
        safeFolderName
      }
    }).trim();

    // `normalizePath` is load-bearing for the vault ROOT, whose `path` is `/` — joining onto it yields a
    // Leading slash, and a note created at `/1. Notes/x.md` is not the same path as the folder Obsidian
    // Actually made.
    const folderPath = getAvailableFolderPath(this.app, normalizePath(join(parentFolder.path, desiredFolderName || safeFolderName)));
    const tokens: CreateFolderTemplateTokens = {
      // Read back from the de-duplicated PATH rather than from the template's own result, so a folder that
      // Collided and became `1. Notes 1` says so in its own notes.
      folderName: basename(folderPath),
      folderPath,
      index,
      parentFolder: parentFolder.name,
      parentFolderPath: parentFolder.path,
      rawFolderName,
      safeFolderName
    };

    const notes = this.planNotes(tokens);

    if (settings.shouldAskBeforeCreatingFolder) {
      const confirmResult = await this.confirmCreate({ notes, parentFolder, tokens });
      if (!confirmResult.isConfirmed) {
        return;
      }
      await this.pluginSettingsComponent.editAndSave((settingsToEdit) => {
        settingsToEdit.shouldAskBeforeCreatingFolder = confirmResult.shouldAskAgain;
      });
    }

    const createdFiles = await this.createFolderWithNotes({ folderPath, notes, parentFolder });
    if (!createdFiles) {
      return;
    }

    await this.runTemplater(createdFiles, tokens);

    const firstFile = createdFiles[0];
    if (firstFile && settings.shouldOpenNoteAfterCreatingFolder) {
      await this.app.workspace.getLeaf().openFile(firstFile, { active: true });
    }

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        preposition: 'in',
        sourcePathOrAbstractFile: folderPath,
        suffix: `, with ${String(createdFiles.length)} note(s)`,
        targetPathOrAbstractFile: parentFolder,
        verb: 'Created folder'
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
   * Asks before creating, showing the NORMALIZED folder name and every note about to appear in it. That
   * preview is the whole point of the dialog here: the other flows ask because their operation is
   * destructive, this one asks because what gets created is not quite what was typed.
   *
   * "Change target" is disabled — the parent folder was either right-clicked or already picked, so there is
   * nothing to reselect.
   *
   * @param params - The planned notes and the folder they go into.
   * @returns The dialog result.
   */
  private async confirmCreate(params: CreateFolderWithNotesCommandHandlerConfirmCreateParams): Promise<ConfirmDialogModalResult> {
    const { notes, parentFolder, tokens } = params;
    const app = this.app;
    return await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openModal(
        new ConfirmDialogModal({
          app,
          buildContent: (fragment): Promise<void> =>
            buildCreateConfirmContent({
              app,
              fragment,
              notes,
              parentFolder,
              tokens
            }),
          canReselectTarget: false,
          confirmButtonMobileText: 'Create and don\'t ask again',
          confirmButtonText: 'Create',
          promiseResolve,
          title: 'Create folder with notes'
        })
      );
    });
  }

  /**
   * Creates the folder and its notes in one reversible transaction, so a failure half-way through leaves no
   * half-built folder behind.
   *
   * @param params - The folder path, the planned notes and the parent folder.
   * @returns The created files in declaration order, or `null` when the operation was cancelled.
   */
  private async createFolderWithNotes(params: CreateFolderWithNotesCommandHandlerCreateFolderWithNotesParams): Promise<null | readonly TFile[]> {
    const { folderPath, notes, parentFolder } = params;
    const abortController = new AbortController();
    const createdFiles: TFile[] = [];

    const progressNotice = showOperationProgressNotice({
      abortController,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          preposition: 'in',
          // The folder does not exist yet, so it is plain text: an internal link to a missing path renders
          // Unresolved, and clicking one CREATES it.
          shouldLinkSource: false,
          sourcePathOrAbstractFile: folderPath,
          targetPathOrAbstractFile: parentFolder,
          verb: 'Creating folder'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });

    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          await vaultTransaction.createFolder(folderPath);
          for (const note of notes) {
            const notePath = getAvailablePath(this.app, normalizePath(join(folderPath, note.name)));
            createdFiles.push(await vaultTransaction.create(notePath, note.content));
          }
        },
        lockTargets: [{ mode: 'subtree', pathOrFile: parentFolder.path }],
        operationName: 'Create folder with notes',
        resourceLockComponent: this.resourceLockComponent
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return null;
      }
      throw error;
    } finally {
      progressNotice?.[Symbol.dispose]();
    }

    return createdFiles;
  }

  /**
   * Applies the same normalization the prompt validated with. Kept in one place so the name that was
   * accepted and the name that gets created can never diverge.
   *
   * @param rawFolderName - The name as typed.
   * @returns The normalized name.
   */
  private normalizeFolderName(rawFolderName: string): string {
    const settings = this.pluginSettingsComponent.settings;
    return normalizeTypedFolderName({
      rawName: rawFolderName,
      replacement: settings.replacement,
      shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
      shouldTitleCase: settings.shouldTitleCaseCreatedFolderName
    });
  }

  /**
   * Makes a resolved note name usable as a file name, and gives it the markdown extension unless it already
   * carries an extension of its own.
   *
   * @param resolvedName - The note name with its tokens resolved.
   * @returns The file name to create.
   */
  private normalizeNoteName(resolvedName: string): string {
    const settings = this.pluginSettingsComponent.settings;
    const fixedName = normalizeTypedFolderName({
      rawName: resolvedName,
      replacement: settings.replacement,
      shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
      // The note name is written by the template author, not typed under time pressure, so it is taken
      // Literally — capitalizing `!.md` into `!.Md` would be actively wrong.
      shouldTitleCase: false
    });
    return fixedName.includes('.') ? fixedName : `${fixedName}${MARKDOWN_EXTENSION}`;
  }

  /**
   * Turns the content template into the concrete notes to write, resolving every token now that the folder's
   * final name is known.
   *
   * @param tokens - The resolved token values.
   * @returns The notes, in declaration order — the first is the one that gets opened.
   */
  private planNotes(tokens: CreateFolderTemplateTokens): readonly PlannedNote[] {
    const sections = parseFolderContentTemplate(this.pluginSettingsComponent.settings.newFolderContentTemplate);
    return sections.map((section) => {
      const resolvedName = resolveCreateFolderTemplateTokens({ template: section.nameTemplate, tokens }).trim();
      const name = this.normalizeNoteName(resolvedName || tokens.safeFolderName);
      return {
        content: resolveCreateFolderTemplateTokens({ template: section.contentTemplate, tokens }),
        name
      };
    });
  }

  /**
   * Prompts for the folder name, rejecting a name that normalizes to nothing usable.
   *
   * Reuses the `obsidian-dev-utils` prompt rather than a bespoke modal: it already re-asks with the typed
   * text preserved when the validator refuses, which is exactly the behavior the reporter's video shows.
   *
   * @returns The name as typed, or `null` when the prompt was cancelled.
   */
  private async promptForFolderName(): Promise<null | string> {
    return await prompt({
      app: this.app,
      cancelButtonText: 'Cancel',
      okButtonText: 'Create',
      placeholder: 'Folder name',
      title: 'Enter folder name',
      valueValidator: (value: string): MaybeReturn<string> => this.validateTypedFolderName(value)
    });
  }

  /**
   * Runs Templater over each created note, exposing this command's tokens to it first.
   *
   * The prelude is written into the note only when Templater will actually process it — otherwise the raw
   * `<%* … %>` block would be left behind as visible garbage.
   *
   * @param files - The created notes.
   * @param tokens - The values to expose to Templater code.
   * @returns A {@link Promise} that resolves when every note has been processed.
   */
  private async runTemplater(files: readonly TFile[], tokens: CreateFolderTemplateTokens): Promise<void> {
    if (!this.pluginSettingsComponent.settings.shouldRunTemplaterOnDestinationFile) {
      return;
    }

    const templaterPlugin = this.app.plugins.plugins['templater-obsidian'];
    if (!templaterPlugin) {
      this.pluginNoticeComponent.showNotice(createFragment((f) => {
        f.appendText('Advanced Note Composer: You have enabled setting ');
        appendCodeBlock(f, 'Should run templater on destination file');
        f.appendText(', but Templater plugin is not installed.');
      }));
      return;
    }

    for (const file of files) {
      await this.app.vault.process(file, (content) => insertTemplaterPrelude({ content, tokens }));
      await templaterPlugin.templater.overwrite_file_commands(file);
    }
  }

  /**
   * Validates what was typed into the prompt, in the terms the user typed it.
   *
   * @param value - The typed name.
   * @returns The error message, or nothing when the name is usable.
   */
  private validateTypedFolderName(value: string): MaybeReturn<string> {
    const normalizedName = this.normalizeFolderName(value);
    if (!normalizedName) {
      return 'Folder name cannot be empty';
    }

    // Only reachable with `Should replace invalid title characters` off, which leaves the characters in
    // Place for the user to fix — the same choice the reporter's own plugin makes.
    if (new RegExp(INVALID_CHARACTERS_REG_EXP.source).test(normalizedName)) {
      return 'Folder name contains invalid characters';
    }
  }
}

/**
 * Builds the create confirmation body: where the folder goes, the name it will actually get, and every note
 * that will appear inside it.
 *
 * @param params - The parameters.
 */
async function buildCreateConfirmContent(params: BuildCreateConfirmContentParams): Promise<void> {
  const {
    app,
    fragment,
    notes,
    parentFolder,
    tokens
  } = params;
  fragment.appendText('Are you sure you want to create ');
  appendCodeBlock(fragment, 'Folder');
  fragment.appendText(' with ');
  appendCodeBlock(fragment, String(notes.length));
  fragment.appendText(' note(s)?');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Folder');
  fragment.appendText(': ');
  // Plain text, not a link: the folder does not exist yet.
  appendCodeBlock(fragment, tokens.folderName);
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Destination');
  fragment.appendText(': ');
  // The destination always exists, so it is a link like every other confirmation dialog's paths (issue
  // #165) — clicking a folder link reveals it in the file explorer, it never creates anything. The root is
  // Labelled `/`, matching the picker's own `getItemText`.
  fragment.append(
    await renderInternalLink({
      app,
      displayText: parentFolder.isRoot() ? '/' : parentFolder.path,
      pathOrAbstractFile: parentFolder
    })
  );
  fragment.createEl('br');
  fragment.createEl('br');
  fragment.createEl('h2', { text: 'Notes that will be created' });
  for (const note of notes) {
    appendCodeBlock(fragment, note.name);
    fragment.createEl('br');
  }
}
