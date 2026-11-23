import type { CommandHandlerRegistrationContext } from '@mnaoumov/obsidian-lib/command-handlers/command-handler';
import type { FileCommandHandlerShouldAddToFileMenuParams } from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';
import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  TFile
} from 'obsidian';

import { FileCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';
import { isMarkdownFile } from '@mnaoumov/obsidian-lib/file-system';
import { renderInternalLink } from '@mnaoumov/obsidian-lib/markdown';

import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { ConfirmDialogModalResult } from '../../ui/confirm-dialog-modal.ts';
import type { LinkedNoteToMergeBack } from './linked-notes-to-merge-back.ts';

import { isFileOrFolderCommandBlocked } from '../../settings/command-visibility/command-block.ts';
import { CommandCategory } from '../../settings/plugin-settings.ts';
import { ConfirmDialogModal } from '../../ui/confirm-dialog-modal.ts';
import { openConfirmDialogModal } from '../../ui/open-minimizable-modal.ts';
import { mergeFilesIntoSingleFile } from '../merge-into-single-file-runner.ts';
import {
  findLinkedNotesToMergeBack,
  hasLinkedNoteCandidate
} from './linked-notes-to-merge-back.ts';

interface BuildMergeLinkedNotesConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly linkedNotes: readonly LinkedNoteToMergeBack[];
  readonly targetFile: TFile;
}

interface MergeLinkedNotesCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * `Merge linked notes back into this note...` (issue #315): the batch form of the merge at the link to the source.
 *
 * Run on a note, it merges back every note that note links or embeds on a line of its own, each in place of its
 * link, as one reversible operation. Which notes qualify is {@link findLinkedNotesToMergeBack}'s answer; a
 * confirmation dialog (gated on `Should ask before merging`) lists them before anything changes.
 */
export class MergeLinkedNotesCommandHandler extends FileCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private registrationShouldAddCommandToSubmenu: boolean | null = null;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MergeLinkedNotesCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-git-merge',
      id: 'merge-linked-notes-back',
      name: 'Merge linked notes back into this note...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  public override async onRegistered(context: CommandHandlerRegistrationContext): Promise<void> {
    await super.onRegistered(context);
    this.registrationShouldAddCommandToSubmenu = context.shouldAddCommandToSubmenu ?? null;
  }

  protected override canExecuteFile(file: TFile): boolean {
    return isMarkdownFile(file)
      && !isFileOrFolderCommandBlocked({ abstractFile: file, commandCategory: CommandCategory.Merge, pluginSettingsComponent: this.pluginSettingsComponent })
      && hasLinkedNoteCandidate({ app: this.app, targetFile: file });
  }

  protected override async executeFile(file: TFile): Promise<void> {
    const { settings } = this.pluginSettingsComponent;
    const linkedNotes = await findLinkedNotesToMergeBack({
      app: this.app,
      // The same rule the batch runner applies to each source, so the dialog never lists a note it then skips.
      isIgnored: (linkedFile) => !settings.shouldAlwaysMergeExcludedItems && settings.isPathIgnored(linkedFile.path, CommandCategory.Merge),
      targetFile: file
    });
    if (linkedNotes.length === 0) {
      this.pluginNoticeComponent.showNotice(
        `${file.path} links no note on a line of its own that can be merged back: each must be linked once, with no heading or block, and not be excluded in the plugin settings.`
      );
      return;
    }

    if (!await this.confirm(file, linkedNotes)) {
      return;
    }

    await mergeFilesIntoSingleFile({
      app: this.app,
      consoleDebugComponent: this.consoleDebugComponent,
      isNewTargetFile: false,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      progressLabel: 'Merging linked notes',
      resourceLockComponent: this.resourceLockComponent,
      shouldMergeAtSourceLinks: true,
      shouldRelocateOwnedAttachments: settings.shouldMoveAttachmentsWhenMergingFile,
      sourceFiles: linkedNotes.map((linkedNote) => linkedNote.file),
      targetFile: file
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    // `obsidian-lib` answers `false` both when nothing set it and when a menu surface that wraps every item in a
    // plugin-titled entry forced it off, so the registration's own answer is kept to let the setting fill only the
    // unset case.
    return this.registrationShouldAddCommandToSubmenu ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFileMenu(params: FileCommandHandlerShouldAddToFileMenuParams): boolean {
    super.shouldAddToFileMenu(params);
    return params.source !== 'link-context-menu';
  }

  private async confirm(targetFile: TFile, linkedNotes: readonly LinkedNoteToMergeBack[]): Promise<boolean> {
    if (!this.pluginSettingsComponent.settings.shouldAskBeforeMerging) {
      return true;
    }

    const result = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openConfirmDialogModal(
        new ConfirmDialogModal({
          app: this.app,
          buildContent: (fragment): Promise<void> => buildMergeLinkedNotesConfirmContent({ app: this.app, fragment, linkedNotes, targetFile }),
          // The target is the note the command runs on, so there is no other target to pick.
          canReselectTarget: false,
          confirmButtonText: 'Merge',
          promiseResolve,
          title: 'Merge linked notes back'
        })
      );
    });

    if (!result.isConfirmed) {
      return false;
    }
    await this.pluginSettingsComponent.editAndSave((settings) => {
      settings.shouldAskBeforeMerging = result.shouldAskAgain;
    });
    return true;
  }
}

/**
 * Lists in the confirmation dialog every note that will be merged back, with the line its link is on.
 *
 * @param params - The notes, the note they go into and the fragment to fill.
 */
export async function buildMergeLinkedNotesConfirmContent(params: BuildMergeLinkedNotesConfirmContentParams): Promise<void> {
  const { app, fragment, linkedNotes, targetFile } = params;
  fragment.appendText(`These ${String(linkedNotes.length)} note(s) will each go in place of its link in `);
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: targetFile }));
  fragment.appendText(', and then be deleted:');
  const list = fragment.createEl('ul');
  for (const linkedNote of linkedNotes) {
    const item = list.createEl('li');
    item.append(await renderInternalLink({ app, pathOrAbstractFile: linkedNote.file }));
    item.appendText(` (line ${String(linkedNote.link.line + 1)})`);
  }
}
