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

/**
 * What the confirmation dialog decided.
 *
 * A three-way answer rather than the `boolean` this returned before issue #205: "Change target" is neither
 * a confirmation nor a cancellation, and collapsing it into either would silently merge into the wrong place
 * or throw the operation away.
 */
export type ConfirmMergeFolderIntoFileResult = 'cancelled' | 'confirmed' | 'reselect-target';

interface BuildConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly noteCount: number;
  readonly sourceFolder: TFolder;
  readonly targetPath: string;
}

interface ConfirmMergeFolderIntoFileParams {
  readonly app: App;
  readonly noteCount: number;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
  readonly targetPath: string;
}

/**
 * Shows the confirmation dialog for merging a folder's contents into a single new note (issue #92). When
 * `Should ask before merging` is off, it confirms immediately.
 *
 * The target note does not exist yet — it is created by the caller, named after the folder and placed by the
 * `Merge folder into file location` setting — so "Change target" here means the FOLDER that note lands in.
 * The caller owns that loop (see `MergeFolderIntoFileCommandHandler.resolveTargetPaths`), because it is the
 * one that knows how the path is derived.
 *
 * @param params - The source folder, the target path, the note count, and the shared app/settings.
 * @returns What the user chose.
 */
export async function confirmMergeFolderIntoFile(params: ConfirmMergeFolderIntoFileParams): Promise<ConfirmMergeFolderIntoFileResult> {
  if (!params.pluginSettingsComponent.settings.shouldAskBeforeMerging) {
    return 'confirmed';
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
        canReselectTarget: true,
        confirmButtonMobileText: 'Merge and don\'t ask again',
        confirmButtonText: 'Merge',
        promiseResolve,
        title: 'Merge folder into single file'
      })
    );
  });

  if (confirmDialogResult.shouldReselectTarget) {
    return 'reselect-target';
  }
  if (!confirmDialogResult.isConfirmed) {
    return 'cancelled';
  }
  await params.pluginSettingsComponent.editAndSave((settings) => {
    settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskAgain;
  });
  return 'confirmed';
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
