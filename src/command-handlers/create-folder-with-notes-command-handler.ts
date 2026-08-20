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
import { noop } from 'obsidian-dev-utils/function';
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
import { InsertMode } from '../insert-mode.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { ConfirmDialogModal } from '../modals/confirm-dialog-modal.ts';
import { selectFolder } from '../modals/select-folder-modal.ts';
import {
  applyNameTransform,
  NameTransformError
} from '../name-transform.ts';
import { resolveNextFolderIndex } from '../next-folder-index.ts';
import { openConfirmDialogModal } from '../open-minimizable-modal.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import { recordRecentTarget } from '../recent-targets.ts';
import { resolveCreateFolderTemplateTokens } from '../template-tokens.ts';
import { buildTemplaterPrelude } from '../templater-prelude.ts';
import { applyPropertiesWrittenDuringRun } from '../templater-run-properties.ts';
import { TEMPLATER_RUN_MODE_OVERWRITE_FILE } from '../templater.ts';
import {
  normalizeTypedFolderNameWithTransform,
  validateTypedFolderName as validateTypedFolderNameValue
} from '../typed-folder-name.ts';

/**
 * Which name a {@link RenameRequest} is about. An enum rather than a nullable note index so a request
 * cannot express "the folder, at note 3".
 */
enum RenameKind {
  Folder = 'Folder',
  Note = 'Note'
}

interface BuildCreateConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly notes: readonly PlannedNote[];
  readonly parentFolder: TFolder;

  /**
   * Closes the dialog and sends the flow to the matching rename prompt. Called by the `Rename` button of the
   * folder row and of each note row.
   */
  requestRename(this: void, renameRequest: RenameRequest): void;

  /**
   * Whether the folder row gets its `Rename` button (issue #214).
   */
  readonly shouldShowFolderRenameButton: boolean;

  /**
   * Whether each note row gets its `Rename` button (issue #214).
   */
  readonly shouldShowNoteRenameButton: boolean;
  readonly tokens: CreateFolderTemplateTokens;
}

/**
 * The confirmation dialog's own result, widened with the one thing only this flow can ask for.
 *
 * The rename lives here rather than on the shared {@link ConfirmDialogModalResult} because only this flow
 * renders rename controls — putting it on the shared result would push a one-flow concept through every
 * other confirmation dialog.
 *
 * OPTIONAL rather than nullable so a plain {@link ConfirmDialogModalResult} still satisfies it: that is what
 * lets the modal's own `promiseResolve` be handed straight through, with no wrapper translating results the
 * shared dialog produced.
 */
interface CreateConfirmResult extends ConfirmDialogModalResult {
  readonly renameRequest?: RenameRequest;
}

interface CreateFolderWithNotesCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface FolderRenameRequest {
  readonly kind: RenameKind.Folder;
}

interface NoteRenameRequest {
  /**
   * The name the row currently previews — what the rename prompt is seeded with. Carried on the request so
   * the flow never has to index back into the note list it just rendered.
   */
  readonly currentName: string;
  readonly kind: RenameKind.Note;

  /**
   * The note's index in the content template's section list — stable across a folder rename and a
   * `Change target`, because {@link parseFolderContentTemplate} depends on neither.
   */
  readonly noteIndex: number;
}

/**
 * A note the content template declared, with its name and content already resolved — everything needed to
 * write it, decided BEFORE the transaction opens so the confirmation dialog and the write cannot disagree.
 */
interface PlannedNote {
  readonly content: string;
  readonly name: string;
}

type RenameRequest = FolderRenameRequest | NoteRenameRequest;

const MARKDOWN_EXTENSION = '.md';

/**
 * A confirmation-dialog row holding one name and its `Rename` button (issue #200).
 */
const NAME_ROW_CLASS = 'advanced-note-composer-confirm-name-row';

const RENAME_BUTTON_CLASS = 'advanced-note-composer-confirm-rename-button';

interface CreateFolderWithNotesCommandHandlerApplyRenameRequestParams {
  readonly notes: readonly PlannedNote[];
  readonly renameRequest: RenameRequest;
  readonly renameState: CreateFolderWithNotesRenameState;
}

interface CreateFolderWithNotesCommandHandlerBuildPlanParams {
  readonly parentFolder: TFolder;
  readonly renameState: CreateFolderWithNotesRenameState;
}

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

interface CreateFolderWithNotesCommandHandlerPlanNotesParams {
  readonly noteNameOverrides: ReadonlyMap<number, string>;
  readonly tokens: CreateFolderTemplateTokens;
}

interface CreateFolderWithNotesCommandHandlerPromptForFolderNameParams {
  readonly defaultValue: string;
  readonly okButtonText: string;
  readonly title: string;
}

interface CreateFolderWithNotesCommandHandlerPromptForNoteNameParams {
  readonly defaultValue: string;
  readonly otherNoteNames: readonly string[];
}

interface CreateFolderWithNotesCommandHandlerResolvePlanParams {
  readonly parentFolder: TFolder;
  readonly rawFolderName: string;
  readonly safeFolderName: string;
}

interface CreateFolderWithNotesCommandHandlerValidateTypedNoteNameParams {
  readonly otherNoteNames: readonly string[];
  readonly value: string;
}

/**
 * Everything the creation needs, all of it derived from ONE parent folder. Bundled so that changing the
 * target (issue #199) swaps the whole set at once and nothing can be left pointing at the old parent.
 */
interface CreateFolderWithNotesPlan {
  readonly folderPath: string;
  readonly notes: readonly PlannedNote[];
  readonly parentFolder: TFolder;
  readonly tokens: CreateFolderTemplateTokens;
}

/**
 * Everything a rename from the confirmation dialog can change (issue #200), carried as one immutable value so
 * the confirmation loop cannot rebuild the plan from a half-updated set.
 *
 * The note overrides SURVIVE a later folder rename or `Change target`: the user named that note deliberately,
 * and re-deriving it from the template would silently undo them.
 */
interface CreateFolderWithNotesRenameState {
  readonly noteNameOverrides: ReadonlyMap<number, string>;
  readonly rawFolderName: string;
  readonly safeFolderName: string;
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
   * resolves through Obsidian's own `Default location for new notes` instead, then hands the answer to the
   * same {@link CreateFolderWithNotesCommandHandler.executeFolder} the folder menu uses.
   *
   * Each of the two entry points therefore has ONE unambiguous source for where the folder goes (issue
   * #194): from the folder menu it is the folder that was right-clicked, from the palette it is Obsidian's
   * setting. That is why this is not a setting and why the picker that used to ask here is gone — a third
   * answer would only exist to contradict one of those two.
   *
   * `getNewFileParent` is what makes all three of Obsidian's modes work, `Same folder as current file`
   * included; the active file is what that mode resolves against, and with no note open the empty path
   * lands on the vault root, exactly as a new note would.
   *
   * @returns A {@link Promise} that resolves when the folder has been created.
   */
  protected override async execute(): Promise<void> {
    const parentFolder = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '');
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

    const rawFolderName = await this.promptForFolderName({
      defaultValue: '',
      okButtonText: 'Create',
      title: 'Enter folder name'
    });
    if (rawFolderName === null) {
      return;
    }

    // Cannot throw: the prompt's validator already ran the same transform over the same text.
    const safeFolderName = await this.normalizeFolderName(rawFolderName);

    const plan = await this.resolvePlan({ parentFolder, rawFolderName, safeFolderName });
    if (!plan) {
      return;
    }

    const createdFiles = await this.createFolderWithNotes({
      folderPath: plan.folderPath,
      notes: plan.notes,
      parentFolder: plan.parentFolder
    });
    if (!createdFiles) {
      return;
    }

    await this.runTemplater(createdFiles, plan.tokens);

    const firstFile = createdFiles[0];
    if (firstFile && this.pluginSettingsComponent.settings.shouldOpenNoteAfterCreatingFolder) {
      await this.app.workspace.getLeaf().openFile(firstFile, { active: true });
    }

    // The folder was created, so the folder it was created IN counts as clicked-on for the next picker
    // (issue #206) — that is the destination the user chose, the new folder being the operation's result.
    recordRecentTarget(plan.parentFolder);

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        preposition: 'in',
        sourcePathOrAbstractFile: plan.folderPath,
        suffix: `, with ${String(createdFiles.length)} note(s)`,
        targetPathOrAbstractFile: plan.parentFolder,
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
   * Runs the prompt a `Rename` button asked for and folds the answer into the rename state (issue #200).
   *
   * Cancelling the prompt returns the state UNCHANGED, so the confirmation dialog reopens exactly as it was —
   * the same "never mind" the parent picker already has.
   *
   * @param params - The current rename state, the notes currently previewed, and what was asked for.
   * @returns The next rename state.
   */
  private async applyRenameRequest(params: CreateFolderWithNotesCommandHandlerApplyRenameRequestParams): Promise<CreateFolderWithNotesRenameState> {
    const { notes, renameRequest, renameState } = params;

    if (renameRequest.kind === RenameKind.Folder) {
      const rawFolderName = await this.promptForFolderName({
        defaultValue: renameState.rawFolderName,
        okButtonText: 'Rename',
        title: 'Rename folder'
      });
      if (rawFolderName === null) {
        return renameState;
      }

      // Cannot throw: the prompt's validator already ran the same transform over the same text.
      return {
        noteNameOverrides: renameState.noteNameOverrides,
        rawFolderName,
        safeFolderName: await this.normalizeFolderName(rawFolderName)
      };
    }

    const noteName = await this.promptForNoteName({
      defaultValue: renameRequest.currentName,
      otherNoteNames: notes.filter((_note, noteIndex) => noteIndex !== renameRequest.noteIndex).map((note) => note.name)
    });
    if (noteName === null) {
      return renameState;
    }

    const noteNameOverrides = new Map(renameState.noteNameOverrides);
    noteNameOverrides.set(renameRequest.noteIndex, noteName);
    return {
      noteNameOverrides,
      rawFolderName: renameState.rawFolderName,
      safeFolderName: renameState.safeFolderName
    };
  }

  /**
   * Resolves everything the creation depends on, for one candidate parent folder.
   *
   * Kept as one function because every value below is derived from `parentFolder` — the sibling-aware index,
   * the rendered folder name, the de-duplicated path, the tokens and the notes that interpolate them. When
   * "Change target" moves the folder somewhere else (issue #199), ALL of it has to be recomputed together,
   * or the confirmation dialog would preview a plan the write then contradicts.
   *
   * @param params - The candidate parent folder and the current rename state.
   * @returns The plan for that parent folder.
   */
  private buildPlan(params: CreateFolderWithNotesCommandHandlerBuildPlanParams): CreateFolderWithNotesPlan {
    const { parentFolder, renameState } = params;
    const { noteNameOverrides, rawFolderName, safeFolderName } = renameState;
    const settings = this.pluginSettingsComponent.settings;
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

    return {
      folderPath,
      notes: this.planNotes({ noteNameOverrides, tokens }),
      parentFolder,
      tokens
    };
  }

  /**
   * Asks before creating, showing the NORMALIZED folder name and every note about to appear in it. That
   * preview is the whole point of the dialog here: the other flows ask because their operation is
   * destructive, this one asks because what gets created is not quite what was typed.
   *
   * @param params - The planned notes and the folder they go into.
   * @returns The dialog result.
   */
  private async confirmCreate(params: CreateFolderWithNotesCommandHandlerConfirmCreateParams): Promise<CreateConfirmResult> {
    const { notes, parentFolder, tokens } = params;
    const app = this.app;
    const settings = this.pluginSettingsComponent.settings;
    return await new Promise<CreateConfirmResult>((promiseResolve) => {
      // Assigned as soon as the modal exists, which is long before any button can be clicked. A function
      // Rather than a nullable modal reference, so the rename handler needs no `?.` — a branch whose false
      // Arm nothing could ever reach, and the coverage gate is at 100 %.
      let closeModal: (this: void) => void = noop;

      function requestRename(renameRequest: RenameRequest): void {
        promiseResolve({
          insertMode: InsertMode.Append,
          isConfirmed: false,
          renameRequest,
          shouldAskAgain: false,
          shouldReselectTarget: false,
          shouldSwitchToSmartCut: false
        });
        // Closing fires `onClose`, which resolves again — the promise is already settled, so it is a no-op.
        closeModal();
      }

      const modal = new ConfirmDialogModal({
        app,
        buildContent: (fragment): Promise<void> =>
          buildCreateConfirmContent({
            app,
            fragment,
            notes,
            parentFolder,
            requestRename,
            shouldShowFolderRenameButton: settings.shouldShowRenameButtonForCreatedFolder,
            shouldShowNoteRenameButton: settings.shouldShowRenameButtonForCreatedNotes,
            tokens
          }),
        canReselectTarget: true,
        confirmButtonMobileText: 'Create and don\'t ask again',
        confirmButtonText: 'Create',
        // Handed straight through: the shared modal knows nothing about renaming, so every result IT produces
        // Simply carries no request.
        promiseResolve,
        title: 'Create folder with notes'
      });

      closeModal = (): void => {
        modal.close();
      };
      openConfirmDialogModal(modal);
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
      app: this.app,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          pluginSettingsComponent: this.pluginSettingsComponent,
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
   * The `Name transform template` runs FIRST, on the untouched typed text (issue #196) — that is what
   * `{{rawString}}` means, and running it after the invalid-character pass would leave it nothing to map.
   *
   * @param rawFolderName - The name as typed.
   * @returns The normalized name.
   */
  private async normalizeFolderName(rawFolderName: string): Promise<string> {
    return await normalizeTypedFolderNameWithTransform({
      app: this.app,
      rawName: rawFolderName,
      settings: this.pluginSettingsComponent.settings,
      // This prompt names a folder that does not exist yet, so the typed text is all there is and the
      // Setting decides. `Rename folder...` opts out instead — it seeds the prompt with an existing name.
      shouldTitleCase: this.pluginSettingsComponent.settings.shouldTitleCaseCreatedFolderName
    });
  }

  /**
   * Makes a resolved note name usable as a file name, and gives it the markdown extension unless it already
   * carries an extension of its own.
   *
   * The `Name transform template` deliberately does NOT run here (issue #196): this name is built from
   * tokens that already carry the transformed folder name, so transforming again would apply the rewrite
   * twice — `{{rawString}} notes` over `alpha` would name the note `Alpha Notes notes`. The transform runs
   * once, where the name enters from outside; a template author who wants more can say so in the template.
   *
   * @param resolvedName - The note name with its tokens resolved.
   * @returns The file name to create, or an empty string when nothing usable was given — the rename prompt's
   * validator reports that rather than letting a note be created literally named `.md`.
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
    if (!fixedName) {
      return '';
    }
    return fixedName.includes('.') ? fixedName : `${fixedName}${MARKDOWN_EXTENSION}`;
  }

  /**
   * Normalizes a note name TYPED into the rename prompt (issue #200).
   *
   * Unlike {@link CreateFolderWithNotesCommandHandler.normalizeNoteName} on its own, the `Name transform
   * template` DOES run here — and that is not a contradiction of the run-once rule. That rule skips the
   * transform for a name built from tokens which already carry it; a typed rename is a name entering from
   * outside, exactly what the transform is for, and it is how the folder prompt already behaves.
   *
   * Everything after the transform is the same call the template path makes, so what the dialog previews and
   * what gets written cannot diverge.
   *
   * @param rawName - The name as typed.
   * @returns The name the note would be created under.
   */
  private async normalizeTypedNoteName(rawName: string): Promise<string> {
    return this.normalizeNoteName(await this.transformName(rawName));
  }

  /**
   * Turns the content template into the concrete notes to write, resolving every token now that the folder's
   * final name is known.
   *
   * A note the user renamed from the confirmation dialog takes its typed name instead of the template's
   * (issue #200); the CONTENT is still the template's, since only the name was renamed.
   *
   * @param params - The resolved token values and the names renamed from the dialog.
   * @returns The notes, in declaration order — the first is the one that gets opened.
   */
  private planNotes(params: CreateFolderWithNotesCommandHandlerPlanNotesParams): readonly PlannedNote[] {
    const { noteNameOverrides, tokens } = params;
    const sections = parseFolderContentTemplate(this.pluginSettingsComponent.settings.newFolderContentTemplate);
    return sections.map((section, noteIndex) => {
      const resolvedName = resolveCreateFolderTemplateTokens({ template: section.nameTemplate, tokens }).trim();
      const name = noteNameOverrides.get(noteIndex) ?? this.normalizeNoteName(resolvedName || tokens.safeFolderName);
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
   * The same prompt serves the initial ask and the confirmation dialog's `Rename` (issue #200) — one
   * validator, so a name refused when creating is refused when renaming. Only the wording differs, and it is
   * passed in rather than derived from the seeded value, so neither call has to guess which one it is.
   *
   * @param params - The seeded value and the wording for this use of the prompt.
   * @returns The name as typed, or `null` when the prompt was cancelled.
   */
  private async promptForFolderName(params: CreateFolderWithNotesCommandHandlerPromptForFolderNameParams): Promise<null | string> {
    const { defaultValue, okButtonText, title } = params;
    return await prompt({
      app: this.app,
      cancelButtonText: 'Cancel',
      defaultValue,
      okButtonText,
      placeholder: 'Folder name',
      title,
      valueValidator: async (value: string): Promise<MaybeReturn<string>> => await this.validateTypedFolderName(value)
    });
  }

  /**
   * Prompts for one note's name, seeded with the name the dialog is previewing (issue #200).
   *
   * @param params - The seeded name and the names the other planned notes already hold.
   * @returns The name as typed, or `null` when the prompt was cancelled.
   */
  private async promptForNoteName(params: CreateFolderWithNotesCommandHandlerPromptForNoteNameParams): Promise<null | string> {
    const { defaultValue, otherNoteNames } = params;
    const typedName = await prompt({
      app: this.app,
      cancelButtonText: 'Cancel',
      defaultValue,
      okButtonText: 'Rename',
      placeholder: 'Note name',
      title: 'Rename note',
      valueValidator: async (value: string): Promise<MaybeReturn<string>> => await this.validateTypedNoteName({ otherNoteNames, value })
    });

    if (typedName === null) {
      return null;
    }

    // Cannot throw: the prompt's validator already ran the same transform over the same text.
    return await this.normalizeTypedNoteName(typedName);
  }

  /**
   * Runs the confirmation dialog and, whenever it comes back with "Change target", the parent-folder picker
   * — looping until the user confirms a plan or cancels (issue #199).
   *
   * The loop is INVERTED relative to the picker-first flows (merge/move/swap): the parent folder is already
   * DECIDED when the command starts — it is the right-clicked folder, or Obsidian's own
   * `Default location for new notes` — so the picker must not run first. It appears only when asked for,
   * and the whole plan is rebuilt around the new parent each pass.
   *
   * Cancelling the picker returns to the same dialog with the parent unchanged, rather than abandoning the
   * creation. The typed NAME is never re-asked by `Change target` — it is re-asked only when the dialog's own
   * `Rename` button asks for it (issue #200), which is the other arm of this loop.
   *
   * @param params - The initial parent folder and the typed/normalized names.
   * @returns The confirmed plan, or `null` when the flow was cancelled.
   */
  private async resolvePlan(params: CreateFolderWithNotesCommandHandlerResolvePlanParams): Promise<CreateFolderWithNotesPlan | null> {
    let parentFolder = params.parentFolder;
    let renameState: CreateFolderWithNotesRenameState = {
      noteNameOverrides: new Map<number, string>(),
      rawFolderName: params.rawFolderName,
      safeFolderName: params.safeFolderName
    };
    if (!this.pluginSettingsComponent.settings.shouldAskBeforeCreatingFolder) {
      return this.buildPlan({ parentFolder, renameState });
    }

    for (;;) {
      const plan = this.buildPlan({ parentFolder, renameState });
      const confirmResult = await this.confirmCreate(plan);
      if (confirmResult.renameRequest) {
        renameState = await this.applyRenameRequest({
          notes: plan.notes,
          renameRequest: confirmResult.renameRequest,
          renameState
        });
        continue;
      }
      if (confirmResult.shouldReselectTarget) {
        const selectedFolder = await selectFolder({
          app: this.app,
          // An ignored folder is refused by `executeFolder` up front, so it is never offered here either.
          isAllowedFolder: (folder) => !this.pluginSettingsComponent.settings.isPathIgnored(folder.path),
          placeholder: 'Select folder to create the new folder in...',
          pluginSettingsComponent: this.pluginSettingsComponent
        });
        if (selectedFolder) {
          parentFolder = selectedFolder;
        }
        continue;
      }
      if (!confirmResult.isConfirmed) {
        return null;
      }
      await this.pluginSettingsComponent.editAndSave((settingsToEdit) => {
        settingsToEdit.shouldAskBeforeCreatingFolder = confirmResult.shouldAskAgain;
      });
      return plan;
    }
  }

  /**
   * Runs Templater over each created note, exposing this command's tokens to it first.
   *
   * This drives Templater itself rather than calling its `overwrite_file_commands`, and the reason is the
   * prelude's POSITION. `overwrite_file_commands` reads the note from disk, so the only way to give it the
   * prelude is to write the prelude into the note — and a file that starts with `<%*` has no frontmatter as
   * far as the metadata cache is concerned, which leaves `tp.frontmatter` empty. Writing it lower instead (it
   * used to go below the frontmatter block) puts `TOKENS` in the temporal dead zone for the frontmatter
   * above it, so `aliases: <% TOKENS.… %>` made Templater abandon the WHOLE note with a generic
   * `Template parsing error, aborting.` — the note kept the raw prelude as visible garbage. Prepending to the
   * parsed STRING has neither problem: the file on disk keeps real frontmatter for the metadata cache, and
   * `TOKENS` is declared before anything that could reference it.
   *
   * Owning the write is also what lets a plain `app.fileManager.processFrontMatter(tp.config.target_file, …)`
   * work: the render is computed from the note as it stood BEFORE that call, so writing it back would revert
   * it — which is why Templater requires `tp.hooks.on_all_templates_executed(…)` everywhere else.
   * {@link applyPropertiesWrittenDuringRun} reconciles the two versions instead, so the hook is optional here.
   *
   * The `start`/`end` task pair is not bookkeeping — it is the only thing that fires
   * `templater:all-templates-executed`, so a template that DOES use `tp.hooks.on_all_templates_executed(…)`
   * never runs its callback without it. It is in a `finally` so a broken template cannot strand the pair.
   *
   * Templater's own cursor jump is deliberately NOT reproduced: it acts on `workspace.activeEditor`, which at
   * this point is still whatever note the user was on — never the note just created, which is opened later.
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

    const templater = templaterPlugin.templater;

    for (const file of files) {
      templater.start_templater_task(file.path);
      try {
        const contentBeforeRun = await this.app.vault.read(file);
        const runningConfig = templater.create_running_config(file, file, TEMPLATER_RUN_MODE_OVERWRITE_FILE);
        const renderedContent = await templater.parse_template(runningConfig, `${buildTemplaterPrelude(tokens)}${contentBeforeRun}`);
        const content = applyPropertiesWrittenDuringRun({
          contentAfterRun: await this.app.vault.read(file),
          contentBeforeRun,
          renderedContent
        });
        await this.app.vault.modify(file, content);
        this.app.workspace.trigger('templater:overwrite-file', { content, file });
      } catch (error) {
        // Templater's own entry point swallows this into a notice that names neither the note nor the
        // Template, and leaves the note unrendered. The note is kept the same way — it already exists and
        // The remaining notes still deserve their turn — but the message says which one failed.
        this.pluginNoticeComponent.showNotice(createFragment((f) => {
          f.appendText('Advanced Note Composer: Templater failed on ');
          appendCodeBlock(f, file.path);
          f.appendText(`: ${error instanceof Error ? error.message : String(error)}`);
        }));
      } finally {
        await templater.end_templater_task(file.path);
      }
    }
  }

  /**
   * Runs the `Name transform template` over a name (issue #196).
   *
   * This command creates a folder rather than working on an existing note, so it has none of its own to
   * offer as the Templater context — the shared fallback chain finds one, and no longer insists that a note
   * be open to do it (issue #218).
   *
   * @param rawString - The name to transform.
   * @returns The transformed name.
   */
  private async transformName(rawString: string): Promise<string> {
    return await applyNameTransform({
      app: this.app,
      contextFile: null,
      rawString,
      template: this.pluginSettingsComponent.settings.nameTransformTemplate
    });
  }

  /**
   * Validates what was typed into the folder-name prompt, in the terms the user typed it.
   *
   * @param value - The typed name.
   * @returns The error message, or nothing when the name is usable.
   */
  private async validateTypedFolderName(value: string): Promise<MaybeReturn<string>> {
    return await validateTypedFolderNameValue({
      app: this.app,
      rawName: value,
      settings: this.pluginSettingsComponent.settings,
      shouldTitleCase: this.pluginSettingsComponent.settings.shouldTitleCaseCreatedFolderName
    });
  }

  /**
   * Validates a note name typed into the confirmation dialog's `Rename` prompt (issue #200).
   *
   * The first two rules mirror {@link CreateFolderWithNotesCommandHandler.validateTypedFolderName}, so a
   * broken `Name transform template` is reported where it can be fixed and a name is judged by the same
   * standard whichever prompt it was typed into.
   *
   * The third has no folder counterpart and closes a real gap: the write de-duplicates through
   * `getAvailablePath`, so two notes renamed to the same thing would silently become `X.md` and `X 1.md` —
   * the dialog would be previewing something other than what gets created. The folder side needs no such
   * rule, because `getAvailableFolderPath` runs while the plan is built and the tokens are read back from the
   * de-duplicated path.
   *
   * @param params - The typed name and the names the other planned notes already hold.
   * @returns The error message, or nothing when the name is usable.
   */
  private async validateTypedNoteName(params: CreateFolderWithNotesCommandHandlerValidateTypedNoteNameParams): Promise<MaybeReturn<string>> {
    const { otherNoteNames, value } = params;
    let normalizedName: string;
    try {
      normalizedName = await this.normalizeTypedNoteName(value);
    } catch (error) {
      /* v8 ignore next 3 -- the transform is the only thing here that throws, and it throws nothing else. */
      if (!(error instanceof NameTransformError)) {
        throw error;
      }
      return error.message;
    }

    if (!normalizedName) {
      return 'Note name cannot be empty';
    }

    if (new RegExp(INVALID_CHARACTERS_REG_EXP.source).test(normalizedName)) {
      return 'Note name contains invalid characters';
    }

    // Case-insensitively: the vault would treat `Alpha.md` and `alpha.md` as the same note on Windows and
    // MacOS, so accepting one as "different" would just move the collision to the write.
    if (otherNoteNames.some((otherNoteName) => otherNoteName.toLowerCase() === normalizedName.toLowerCase())) {
      return 'Another note in this folder is already named that';
    }
  }
}

/**
 * Appends the `Rename` button that sits beside a name in the confirmation dialog (issue #200).
 *
 * A text label rather than an icon: the complaint the issue files is that there is no rename button, so it
 * has to read as one.
 *
 * A plain `button` with a real listener rather than a `ButtonComponent`, matching how
 * {@link ConfirmDialogModal} builds its own buttons — the click is then a real DOM event, which is what lets
 * both the unit test and the desktop integration test drive it by clicking.
 *
 * @param rowEl - The row the name was just written into.
 * @param onClick - What the button asks the flow to rename.
 */
function appendRenameButton(rowEl: HTMLElement, onClick: (this: void) => void): void {
  rowEl.createEl('button', {
    attr: { 'aria-label': 'Change this name before anything is created' },
    cls: RENAME_BUTTON_CLASS,
    text: 'Rename'
  }, (buttonEl) => {
    buttonEl.addEventListener('click', onClick);
  });
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
    requestRename,
    shouldShowFolderRenameButton,
    shouldShowNoteRenameButton,
    tokens
  } = params;
  fragment.appendText('Are you sure you want to create ');
  appendCodeBlock(fragment, 'Folder');
  fragment.appendText(' with ');
  appendCodeBlock(fragment, String(notes.length));
  fragment.appendText(' note(s)?');
  fragment.createEl('br');
  fragment.createEl('br');
  const folderRowEl = fragment.createDiv(NAME_ROW_CLASS);
  appendCodeBlock(folderRowEl, 'Folder');
  folderRowEl.appendText(': ');
  // Plain text, not a link: the folder does not exist yet.
  appendCodeBlock(folderRowEl, tokens.folderName);
  if (shouldShowFolderRenameButton) {
    appendRenameButton(folderRowEl, () => {
      requestRename({ kind: RenameKind.Folder });
    });
  }
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
  for (const [noteIndex, note] of notes.entries()) {
    const noteRowEl = fragment.createDiv(NAME_ROW_CLASS);
    appendCodeBlock(noteRowEl, note.name);
    if (shouldShowNoteRenameButton) {
      appendRenameButton(noteRowEl, () => {
        requestRename({ currentName: note.name, kind: RenameKind.Note, noteIndex });
      });
    }
  }
}
