import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { applySplitTemplateToNotes } from '../apply-split-template.ts';
import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { resolveTemplateTail } from '../create-note-template.ts';
import { createNoteFromTypedName } from '../create-note.ts';
import { INVALID_CHARACTERS_REG_EXP } from '../filename-validation.ts';
import {
  NameTransformError,
  transformAndFixFileName
} from '../name-transform.ts';
import { openFileAfterOperation } from '../open-after-operation.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice
} from '../operation-notices.ts';
import { CommandCategory } from '../plugin-settings.ts';
import { recordRecentTarget } from '../recent-targets.ts';
import { placeCaretFromEnd } from '../reveal-inserted-content.ts';

interface CreateEmptyNoteInFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Creates one empty note in a folder, from the file explorer's context menu (issue #244).
 *
 * It is the explorer half of `Create empty note at cursor...`, and it is deliberately NOT that command with
 * a different subject: there is no note, no cursor and therefore no link to leave behind, so most of the
 * extract apparatus — the picker, the selection, the residual — has nothing to act on. What is shared is the
 * part that matters, {@link createNoteFromTypedName}: the `Name transform template`, the invalid-character
 * pass, the alias and the frontmatter title all behave exactly as they do for a split.
 *
 * The `Split template` is shared too, once configured: a note this plugin creates carries the user's
 * template whichever door it came through, and the caret lands where its `{{content}}` was. Only the
 * `{{from…}}` half of the vocabulary cannot follow — this note was created out of nothing, so there is no
 * note it came FROM and those tokens resolve empty.
 *
 * `Create folder with notes...` is the neighboring command and stays distinct: that one creates a FOLDER
 * from a content template, which is why the reporter of #244 says a single-note path stops people abusing it.
 */
export class CreateEmptyNoteInFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: CreateEmptyNoteInFolderCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-file-plus',
      id: 'create-empty-note-in-folder',
      name: 'Create empty note in folder...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  /**
   * Like `Create folder with notes...`, this command needs no folder to already be in play — it CREATES
   * something. The base would hide it from the palette whenever no note is open, because it resolves the
   * active file's parent as its subject.
   *
   * @returns Always `true`.
   */
  protected override canExecute(): boolean {
    return true;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    return !isFileOrFolderCommandBlocked({ abstractFile: folder, commandCategory: CommandCategory.Create, pluginSettingsComponent: this.pluginSettingsComponent });
  }

  /**
   * The command-palette path, resolving the destination through Obsidian's own `Default location for new
   * notes` — the same two-entry-point rule `Create folder with notes...` documents (issue #194): from the
   * folder menu the subject is the folder that was right-clicked, from the palette it is that setting.
   *
   * @returns A {@link Promise} that resolves when the note has been created.
   */
  protected override async execute(): Promise<void> {
    const parentFolder = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '');
    await this.executeFolder(parentFolder);
  }

  protected override async executeFolder(parentFolder: TFolder): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(parentFolder.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot create a note in ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: parentFolder }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const typedName = await prompt({
      app: this.app,
      cancelButtonText: 'Cancel',
      defaultValue: '',
      okButtonText: 'Create',
      placeholder: 'Note name',
      title: 'Enter note name',
      valueValidator: async (value: string): Promise<MaybeReturn<string>> => await this.validateTypedNoteName(value)
    });
    if (typedName === null) {
      return;
    }

    const file = await createNoteFromTypedName({
      app: this.app,
      // No note of its own to offer as the Templater context; the shared fallback chain finds one
      // (issue #218).
      contextFile: null,
      fileName: typedName,
      folderPrefix: `/${parentFolder.getParentPrefix()}`,
      pluginSettingsComponent: this.pluginSettingsComponent,
      // `shouldSplitIntoFolder` is named for splitting and must not silently wrap an explorer-created note
      // In a folder of its own — `Create folder with notes...` is the command for that.
      relocateNote: null,
      // The destination was chosen by the right-click, so a typed `/` is a character in a name rather than a
      // Path to descend into.
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });

    const templateTail = await this.applySplitTemplate(file);

    // The user asked for a note in a place they pointed at, with no cursor to preserve — so it opens. The
    // Editor command deliberately does not (`shouldOpenTargetNoteAfterSplit`, off by default), which is what
    // Makes the ghost-note workflow of issue #244 work.
    await openFileAfterOperation({ app: this.app, file });

    if (templateTail !== null) {
      // The note came out holding the template, so the caret goes where its `{{content}}` was rather than
      // Wherever the freshly opened note happens to put it.
      await placeCaretFromEnd({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        file,
        tail: templateTail
      });
    }

    // The folder the note landed in is the destination the user chose, so it counts as clicked-on for the
    // Next picker (issue #206).
    recordRecentTarget(parentFolder);

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        preposition: 'in',
        sourcePathOrAbstractFile: file.path,
        targetPathOrAbstractFile: parentFolder,
        verb: 'Created empty note'
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
   * Fills the created note with the `Split template`, exactly as a split into a brand-new note is filled
   * (issue #244).
   *
   * The work is `applySplitTemplateToNotes`', not a second copy of it: that function already writes the
   * template around a note's existing content while leaving the note's own frontmatter block in place and
   * merging the template's into it — which is precisely the state {@link createNoteFromTypedName} can leave
   * behind, with an alias and a `frontmatterTitleMode` title already written. The only thing this flow does
   * differently is have no source note, so the `{{from…}}` tokens resolve empty.
   *
   * @param file - The note that was just created.
   * @returns The resolved template tail — what the note now ends with, and therefore where the caret goes —
   * or `null` when no template is configured and the note was left empty.
   */
  private async applySplitTemplate(file: TFile): Promise<null | string> {
    const template = this.pluginSettingsComponent.settings.splitTemplate;
    // An empty `Split template` means the note stays genuinely empty, which is what this command shipped
    // Doing. `Merge template` is deliberately not the fallback the split chain makes it: wrapping it around
    // No content is what would leave two blank lines behind.
    if (!template) {
      return null;
    }

    const folderNameTemplate = this.pluginSettingsComponent.settings.reorderedFolderNameTemplate;
    await applySplitTemplateToNotes({
      app: this.app,
      folderNameTemplate,
      notes: [{
        file,
        // Created out of nothing, so there is no note it came FROM.
        sourceFile: null
      }],
      resourceLockComponent: this.resourceLockComponent,
      template
    });

    return resolveTemplateTail({
      folderNameTemplate,
      sourceFile: null,
      targetFile: file,
      template
    });
  }

  /**
   * Validates what was typed into the note-name prompt, in the terms the user typed it.
   *
   * The rules mirror `Create folder with notes...`'s rename prompt, so a name is judged by the same standard
   * whichever prompt it was typed into: a broken `Name transform template` is reported where it can be fixed,
   * a blank name is refused rather than becoming `Untitled` behind the user's back, and a name still holding
   * invalid characters is refused (only reachable with `shouldReplaceInvalidTitleCharacters` off, which is
   * what that setting is FOR — issue #196).
   *
   * A collision needs no rule: `createNewMarkdownFileFromLinktext` de-duplicates, and nothing here previews a
   * name that the write could then contradict.
   *
   * @param value - The typed name.
   * @returns The error message, or nothing when the name is usable.
   */
  private async validateTypedNoteName(value: string): Promise<MaybeReturn<string>> {
    if (!value.trim()) {
      return 'Note name cannot be empty';
    }

    const settings = this.pluginSettingsComponent.settings;
    let fixedName: string;
    try {
      fixedName = await transformAndFixFileName({
        app: this.app,
        contextFile: null,
        fileName: value,
        nameTransformTemplate: settings.nameTransformTemplate,
        replacement: settings.replacement,
        shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
        shouldTreatTitleAsPath: false
      });
    } catch (error) {
      /* v8 ignore next 3 -- the transform is the only thing here that throws, and it throws nothing else. */
      if (!(error instanceof NameTransformError)) {
        throw error;
      }
      return error.message;
    }

    if (!fixedName.trim()) {
      return 'Note name cannot be empty';
    }

    if (new RegExp(INVALID_CHARACTERS_REG_EXP.source).test(fixedName)) {
      return 'Note name contains invalid characters';
    }
  }
}
