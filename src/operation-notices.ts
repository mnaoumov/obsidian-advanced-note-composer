import type {
  App,
  Notice
} from 'obsidian';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentDelayedNotice,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { PathOrAbstractFile } from 'obsidian-dev-utils/obsidian/file-system';
import type { ValueProvider } from 'obsidian-dev-utils/value-provider';

import { InternalPluginName } from '@obsidian-typings/obsidian-public-latest/implementations';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { normalizeOptionalProperties } from 'obsidian-dev-utils/object-utils';
import { PluginNoticeMode } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import {
  getAbstractFileOrNull,
  isFile,
  isFolder
} from 'obsidian-dev-utils/obsidian/file-system';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { resolveFolderNoteFromSettings } from './folder-note.ts';
import { openFileAfterOperation } from './open-after-operation.ts';

/**
 * Parameters for {@link buildOperationNoticeContent}.
 */
export interface BuildOperationNoticeContentParams {
  readonly app: App;

  /**
   * Whether the operation is still running. When `true` the content ends with the `is-loading` spinner
   * instead of a period, which is what makes a progress notice read as "still going".
   *
   * @default `false`
   */
  readonly isLoading?: boolean;

  /**
   * What clicking the TARGET link should do on top of opening the note and revealing it (issue #232).
   *
   * Supplied by the extract/split flow to land the user on the content it just wrote; every other
   * operation omits it and the link behaves as it always has. Invoked through `invokeAsyncSafely`, since a
   * DOM click listener cannot await.
   *
   * @default `undefined`
   */
  // `this: void` because it is a standalone callback, never a method of these params — which is also what
  // Lets it be destructured and handed on without tripping `unbound-method`.
  onTargetLinkClick?(this: void): Promise<void>;

  /**
   * Read on click, to answer which note is a folder's folder note.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;

  /**
   * The word joining the source to the target. `into` fits every merge/split/move; a swap reads `with`.
   * Ignored when there is no target.
   *
   * @default `'into'`
   */
  readonly preposition?: string;

  /**
   * Whether the source is rendered as a clickable internal link. Operations that CONSUME their source (a
   * merge trashes the note it merged away) must pass `false`: an internal link to a path that no longer
   * exists renders as unresolved, and clicking an unresolved note link CREATES that note — so the notice
   * reporting a deletion would offer to undo it by accident.
   *
   * @default `true`
   */
  readonly shouldLinkSource?: boolean;

  /**
   * The note or folder the operation acts on.
   */
  readonly sourcePathOrAbstractFile: PathOrAbstractFile;

  /**
   * Extra text appended after the last link, before the terminating period — e.g. ` and updated 3 links`.
   *
   * @default `''`
   */
  readonly suffix?: string;

  /**
   * The note or folder the operation acts on the source WITH. Omitted by operations that have only one
   * side, such as a flatten or a heading rename.
   *
   * @default `undefined`
   */
  readonly targetPathOrAbstractFile?: PathOrAbstractFile;

  /**
   * The verb phrase opening the notice — `Merging note` while it runs, `Merged note` once it is done.
   */
  readonly verb: string;
}

/**
 * Parameters for {@link renderOperationNoticeLink}.
 */
export interface RenderOperationNoticeLinkParams {
  readonly app: App;

  /**
   * What to run on click, on top of the open and the reveal.
   *
   * @default `undefined`
   */
  // See {@link BuildOperationNoticeContentParams.onTargetLinkClick} for why `this: void`.
  onClick?(this: void): Promise<void>;

  readonly pathOrAbstractFile: PathOrAbstractFile;

  /**
   * Read on click, to answer which note is a folder's folder note.
   */
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Parameters for {@link showOperationCompletionNotice}.
 */
export interface ShowOperationCompletionNoticeParams {
  readonly content: DocumentFragment | string;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Parameters for {@link showOperationPermanentProgressNotice}.
 */
export interface ShowOperationPermanentProgressNoticeParams {
  readonly content: DocumentFragment;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Parameters for {@link showOperationProgressNotice}.
 */
export interface ShowOperationProgressNoticeParams {
  /**
   * The operation's abort controller, which the notice's Cancel button aborts. Omitted by operations that
   * have no cancellation path, so no Cancel button is offered rather than one that does nothing.
   *
   * @default `undefined`
   */
  readonly abortController?: AbortController;

  /**
   * The notice content, resolved lazily only if the delay elapses.
   */
  readonly content: ValueProvider<DocumentFragment | string>;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Builds the content shared by every operation notice: `<verb> <source>[ <preposition> <target>][suffix]`,
 * with both paths rendered as clickable internal links, closed either by the `is-loading` spinner (a
 * progress notice) or by a period (a completion notice).
 *
 * @param params - The parameters.
 * @returns A {@link Promise} resolving to the notice content fragment.
 */
export function buildOperationNoticeContent(params: BuildOperationNoticeContentParams): Promise<DocumentFragment> {
  const {
    app,
    isLoading,
    onTargetLinkClick,
    pluginSettingsComponent,
    preposition,
    shouldLinkSource,
    sourcePathOrAbstractFile,
    suffix,
    targetPathOrAbstractFile,
    verb
  } = params;

  return createFragmentAsync(async (fragmentEl) => {
    fragmentEl.appendText(`${verb} `);
    if (shouldLinkSource ?? true) {
      fragmentEl.append(await renderOperationNoticeLink({ app, pathOrAbstractFile: sourcePathOrAbstractFile, pluginSettingsComponent }));
    } else {
      // Deliberately NOT `getPath()`: that resolves the path against the vault, and the whole reason this
      // Branch exists is that the source is already gone from it.
      appendCodeBlock(fragmentEl, typeof sourcePathOrAbstractFile === 'string' ? sourcePathOrAbstractFile : sourcePathOrAbstractFile.path);
    }
    if (targetPathOrAbstractFile !== undefined) {
      fragmentEl.appendText(` ${preposition ?? 'into'} `);
      fragmentEl.append(
        await renderOperationNoticeLink(normalizeOptionalProperties<RenderOperationNoticeLinkParams>({
          app,
          onClick: onTargetLinkClick,
          pathOrAbstractFile: targetPathOrAbstractFile,
          pluginSettingsComponent
        }))
      );
    }
    if (suffix !== undefined) {
      fragmentEl.appendText(suffix);
    }
    if (isLoading ?? false) {
      fragmentEl.createDiv('is-loading');
      return;
    }
    fragmentEl.appendText('.');
  });
}

/**
 * Renders the clickable link an operation notice names a file or folder with.
 *
 * Everything about the link itself is dev-utils' {@link renderInternalLink} — a real rendered wikilink whose
 * click Obsidian's own handler turns into an open. What is added here is the half each branch is missing:
 *
 * - A FILE link also REVEALS the file in the file explorer (issue #232) — what dev-utils' folder branch has
 *   always done, which is what makes the two read consistently.
 * - A FOLDER link also OPENS that folder's FOLDER NOTE (issue #234), so the click lands the user in a
 *   document instead of leaving them in the explorer. Which note that is, is the plugin's own `Folder note`
 *   settings' answer — the same one `Rename folder...` and the reorder commands keep in step.
 *
 * Both land on every notice this module builds rather than on the one operation each issue was filed about.
 *
 * Deliberately no `preventDefault` — each addition is layered ON TOP of what the click already did, never
 * instead of it, so the folder stays highlighted while its note opens. A path that does not resolve gets
 * neither: an unresolved note has nothing to reveal (clicking one CREATES it, which is the behavior
 * {@link BuildOperationNoticeContentParams.shouldLinkSource} exists to keep notices away from), and a folder
 * WITHOUT a folder note opens nothing at all rather than creating one — `resolveFolderNoteFromSettings`
 * answers `null` for it, which is exactly the reveal-only behavior #234 improves on.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} resolving to the rendered anchor.
 */
export async function renderOperationNoticeLink(params: RenderOperationNoticeLinkParams): Promise<HTMLAnchorElement> {
  const {
    app,
    onClick,
    pathOrAbstractFile,
    pluginSettingsComponent
  } = params;
  const aEl = await renderInternalLink({ app, pathOrAbstractFile });

  aEl.addEventListener('click', () => {
    // Resolved HERE rather than at render time, on purpose. A notice outlives the operation that showed it,
    // So the vault it is read against is the one at CLICK time — a destination renamed in between still
    // Reveals the right item, and a folder note written after the notice appeared is still found. It also
    // Keeps rendering a notice free of any vault lookup of its own.
    const abstractFile = getAbstractFileOrNull({ app, pathOrFile: pathOrAbstractFile });
    // Folders already reveal — that IS dev-utils' folder branch, which owns the reveal half of their click
    // — so only a real file needs one added here, and a path that no longer resolves needs none at all.
    if (isFile(abstractFile)) {
      app.internalPlugins.getEnabledPluginById(InternalPluginName.FileExplorer)?.revealInFolder(abstractFile);
    }

    if (isFolder(abstractFile)) {
      const folderNote = resolveFolderNoteFromSettings({ app, folder: abstractFile, settings: pluginSettingsComponent.settings });
      if (folderNote) {
        // A DOM listener cannot await. `invokeAsyncSafely` also outlives the handler, which the open needs:
        // It settles before opening, for the click that lands right as the operation finishes writing.
        invokeAsyncSafely(() => openFileAfterOperation({ app, file: folderNote }));
      }
    }

    if (onClick) {
      // A DOM listener cannot await, and the jump has to outlive this handler: it polls for the very view
      // Obsidian's own handler is still opening.
      invokeAsyncSafely(onClick);
    }
  });
  return aEl;
}

/**
 * Reports a finished operation, unless the user turned operation notices off.
 *
 * Shown as a STANDALONE notice ({@link PluginNoticeMode.Separate}) rather than in the shared per-plugin
 * slot. An operation can have more than one thing to say — a folder merge reports which notes it skipped as
 * ignored, and that summary is emitted on either side of this one depending on the flow — and a slot notice
 * silently replaces whatever is in the slot, so one report would erase the other.
 *
 * `obsidian-dev-utils` 93 replaced the `isReusable` boolean this used to pass with
 * {@link PluginNoticeMode}; `Separate` is that boolean's `false` — it "never replaces, and is never
 * replaced by, a slot notice" — so the behavior above is unchanged.
 *
 * @param params - The parameters.
 */
export function showOperationCompletionNotice(params: ShowOperationCompletionNoticeParams): void {
  const { content, pluginNoticeComponent, pluginSettingsComponent } = params;
  if (!pluginSettingsComponent.settings.shouldShowOperationNotices) {
    return;
  }
  pluginNoticeComponent.showNotice(content, { mode: PluginNoticeMode.Separate });
}

/**
 * Shows a permanent progress notice for a batch operation whose steps are reported as one unit, unless the
 * user turned operation notices off. Unlike {@link showOperationProgressNotice} it appears immediately —
 * these operations are long by construction, so there is no fast case to avoid flashing.
 *
 * @param params - The parameters.
 * @returns The notice, or `null` when operation notices are off.
 */
export function showOperationPermanentProgressNotice(params: ShowOperationPermanentProgressNoticeParams): Notice | null {
  const { content, pluginNoticeComponent, pluginSettingsComponent } = params;
  if (!pluginSettingsComponent.settings.shouldShowOperationNotices) {
    return null;
  }
  return pluginNoticeComponent.showNotice(content, { isPermanent: true });
}

/**
 * Shows a progress notice once the operation has run long enough to be worth reporting, unless the user
 * turned operation notices off.
 *
 * @param params - The parameters.
 * @returns A handle whose disposal hides the notice, or `null` when operation notices are off — so callers
 * dispose it as `progressNotice?.[Symbol.dispose]()`.
 */
export function showOperationProgressNotice(params: ShowOperationProgressNoticeParams): null | PluginNoticeComponentDelayedNotice {
  const {
    abortController,
    content,
    pluginNoticeComponent,
    pluginSettingsComponent
  } = params;
  if (!pluginSettingsComponent.settings.shouldShowOperationNotices) {
    return null;
  }
  return pluginNoticeComponent.showNoticeAfterDelay(normalizeOptionalProperties<PluginNoticeComponentShowNoticeAfterDelayParams>({ abortController, content }));
}
