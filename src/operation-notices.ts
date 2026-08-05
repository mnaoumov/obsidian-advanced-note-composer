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

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { normalizeOptionalProperties } from 'obsidian-dev-utils/object-utils';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

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
      fragmentEl.append(await renderInternalLink({ app, pathOrAbstractFile: sourcePathOrAbstractFile }));
    } else {
      // Deliberately NOT `getPath()`: that resolves the path against the vault, and the whole reason this
      // Branch exists is that the source is already gone from it.
      appendCodeBlock(fragmentEl, typeof sourcePathOrAbstractFile === 'string' ? sourcePathOrAbstractFile : sourcePathOrAbstractFile.path);
    }
    if (targetPathOrAbstractFile !== undefined) {
      fragmentEl.appendText(` ${preposition ?? 'into'} `);
      fragmentEl.append(await renderInternalLink({ app, pathOrAbstractFile: targetPathOrAbstractFile }));
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
 * Reports a finished operation, unless the user turned operation notices off.
 *
 * Shown as a STANDALONE notice (`isReusable: false`) rather than in the shared per-plugin slot. An
 * operation can have more than one thing to say — a folder merge reports which notes it skipped as
 * ignored, and that summary is emitted on either side of this one depending on the flow — and a reusable
 * notice silently replaces whatever is in the slot, so one report would erase the other.
 *
 * @param params - The parameters.
 */
export function showOperationCompletionNotice(params: ShowOperationCompletionNoticeParams): void {
  const { content, pluginNoticeComponent, pluginSettingsComponent } = params;
  if (!pluginSettingsComponent.settings.shouldShowOperationNotices) {
    return;
  }
  pluginNoticeComponent.showNotice(content, { isReusable: false });
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
