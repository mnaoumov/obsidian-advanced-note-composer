import type {
  App,
  TFolder
} from 'obsidian';

import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { ConfirmDialogModalResult } from './confirm-dialog-modal.ts';

import { openMinimizableModal } from '../open-minimizable-modal.ts';
import { ConfirmDialogModal } from './confirm-dialog-modal.ts';

interface BuildConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly noteCount: number;
  readonly sourceFolder: TFolder;
  readonly targetPath: string;
}

interface ShouldMergeFolderIntoFileParams {
  readonly app: App;
  readonly noteCount: number;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
  readonly targetPath: string;
}

/**
 * Shows the confirmation dialog for merging a folder's contents into a single new note (issue #92). The
 * target note is created by the caller (named after the folder), so there is no target picker and no
 * "Change target" action. When `Should ask before merging` is off, it confirms immediately.
 *
 * @param params - The source folder, the target path, the note count, and the shared app/settings.
 * @returns A {@link Promise} resolving to `true` when the merge should proceed, `false` when cancelled.
 */
export async function shouldMergeFolderIntoFile(params: ShouldMergeFolderIntoFileParams): Promise<boolean> {
  if (!params.pluginSettingsComponent.settings.shouldAskBeforeMerging) {
    return true;
  }

  const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
    openMinimizableModal(
      new ConfirmDialogModal({
        app: params.app,
        buildContent: (fragment): Promise<void> =>
          buildConfirmContent({
            app: params.app,
            fragment,
            noteCount: params.noteCount,
            sourceFolder: params.sourceFolder,
            targetPath: params.targetPath
          }),
        canReselectTarget: false,
        confirmButtonMobileText: 'Merge and don\'t ask again',
        confirmButtonText: 'Merge',
        promiseResolve,
        title: 'Merge folder into single file'
      })
    );
  });

  if (!confirmDialogResult.isConfirmed) {
    return false;
  }
  await params.pluginSettingsComponent.editAndSave((settings) => {
    settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskAgain;
  });
  return true;
}

/* v8 ignore start -- builds the confirmation dialog DOM; exercised via desktop integration tests, not unit tests. */
async function buildConfirmContent(params: BuildConfirmContentParams): Promise<void> {
  const {
    app,
    fragment,
    noteCount,
    sourceFolder,
    targetPath
  } = params;
  fragment.appendText(`Are you sure you want to merge all ${String(noteCount)} note(s) in `);
  appendCodeBlock(fragment, 'Folder');
  fragment.appendText(' into a single new note ');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText('? The merged notes will be deleted.');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Folder');
  fragment.appendText(': ');
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: sourceFolder.path }));
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText(': ');
  /*
   * A code block, NOT a `renderInternalLink` (issue #166): the merged note is created only AFTER this dialog
   * is confirmed, so a link to it would be unresolved and clicking it would CREATE the note — colliding with
   * the one the merge is about to create at this very (already de-duplicated) path. The settled rule is
   * `link when the path already exists, code block when it does not`; do not "fix" this back to a link for
   * consistency with the `Folder` row above, whose folder does exist.
   */
  appendCodeBlock(fragment, targetPath);
}
/* v8 ignore stop */
