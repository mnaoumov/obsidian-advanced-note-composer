import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  Editor,
  TFile
} from 'obsidian';

import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';

import type { Selection } from '../composers/composer-base.ts';
import type { InsertMode } from '../composers/insert-mode.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { CommandCategory } from '../settings/plugin-settings.ts';

import { sanitizeHeadingForSubpath } from '../headings/rename-heading.ts';
import { createMoveToken } from '../smart-cut/move/move-token.ts';
import { SplitComposer } from '../split/split-composer.ts';
import { resolveHeadingInsertOffset } from './heading-insert-offset.ts';
import {
  selectTargetHeading,
  selectTargetNoteForMove
} from './move-under-heading-modals.ts';

/**
 * Where the content goes: the note, the heading's subpath for the residual link, the end of the heading's
 * body it goes to, and the offset that end resolved to when the pickers closed.
 */
export interface HeadingMoveDestination {
  readonly insertMode: InsertMode;
  readonly targetCursorOffset: number;
  readonly targetFile: TFile;
  readonly targetSubpath: string;
}

/**
 * The inputs of {@link pickHeadingMoveDestination}.
 */
export interface PickHeadingMoveDestinationParams {
  readonly app: App;

  /**
   * The source selection offsets, captured before any picker opened.
   */
  readonly capturedSelections: readonly Selection[];

  /**
   * The category whose content filter decides which notes the picker offers.
   */
  readonly commandCategory: CommandCategory;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFile: TFile;
}

/**
 * The inputs of {@link runMoveUnderHeading}.
 */
export interface RunMoveUnderHeadingParams {
  readonly app: App;
  readonly capturedSelections: Selection[];
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly destination: HeadingMoveDestination;

  /**
   * An editor the composer can start from. It re-opens the source note itself, so this need not show it.
   */
  readonly editor: Editor;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectedText: string;
  readonly sourceFile: TFile;
}

/**
 * Asks for the note and then the heading the captured selection goes under, and resolves where it lands.
 *
 * The offset is resolved from the note as it stands once the heading picker closes, since that picker was
 * open for as long as the user wanted.
 *
 * @param params - The parameters.
 * @returns The destination, or `null` when a picker was dismissed or there is nowhere to move to.
 */
export async function pickHeadingMoveDestination(params: PickHeadingMoveDestinationParams): Promise<HeadingMoveDestination | null> {
  const { app, pluginNoticeComponent, pluginSettingsComponent } = params;
  const targetFile = await selectTargetNoteForMove({ app, commandCategory: params.commandCategory, pluginSettingsComponent });
  if (!targetFile) {
    return null;
  }

  const cache = await getCacheSafe(app, targetFile);
  const headings = cache?.headings ?? [];
  if (headings.length === 0) {
    pluginNoticeComponent.showNotice(`Note ${targetFile.path} has no headings to move the selection under.`);
    return null;
  }

  const headingTarget = await selectTargetHeading({ app, headings, pluginSettingsComponent, targetFile });
  if (!headingTarget) {
    return null;
  }

  const content = await app.vault.read(targetFile);
  const currentCache = await getCacheSafe(app, targetFile);
  const currentHeadings = currentCache?.headings ?? [];
  const heading = currentHeadings[headingTarget.headingIndex];
  if (!heading) {
    pluginNoticeComponent.showNotice(`The chosen heading is no longer in note ${targetFile.path}.`);
    return null;
  }

  const targetCursorOffset = resolveHeadingInsertOffset({
    content,
    headingIndex: headingTarget.headingIndex,
    headings: currentHeadings,
    insertMode: headingTarget.insertMode
  });

  // The token would be removed along with the selection it sits inside, and the content with it.
  if (
    targetFile === params.sourceFile
    && params.capturedSelections.some((selection) => selection.startOffset < targetCursorOffset && targetCursorOffset < selection.endOffset)
  ) {
    pluginNoticeComponent.showNotice('Cannot move a selection under a heading that is inside the selection itself.');
    return null;
  }

  return {
    insertMode: headingTarget.insertMode,
    targetCursorOffset,
    targetFile,
    targetSubpath: `#${sanitizeHeadingForSubpath(heading.heading)}`
  };
}

/**
 * Moves the captured selection to a destination {@link pickHeadingMoveDestination} resolved, without opening
 * the target note (a white-box port of what `Text Mover` does, onto this plugin's own split pipeline).
 *
 * The content goes through `SplitComposer`'s token path, so everything an extract into an existing note does
 * still applies: the `Split template` (made to start on a line of its own), footnote fixing, attachments, the
 * residual from `Text after extraction` (linked to the heading), the locked, reversible transaction and the
 * completion notice. The note is opened afterwards only when `Should open target note after split` is on.
 *
 * @param params - The parameters.
 */
export async function runMoveUnderHeading(params: RunMoveUnderHeadingParams): Promise<void> {
  const { destination } = params;
  const composer = new SplitComposer({
    app: params.app,
    capturedSelections: params.capturedSelections,
    consoleDebugComponent: params.consoleDebugComponent,
    editor: params.editor,
    insertMode: destination.insertMode,
    insertToken: createMoveToken(),
    isMultipleSplit: false,
    isNewTargetFile: false,
    pluginNoticeComponent: params.pluginNoticeComponent,
    pluginSettingsComponent: params.pluginSettingsComponent,
    resourceLockComponent: params.resourceLockComponent,
    selectedText: params.selectedText,
    shouldOpenTargetAfterMove: false,
    shouldStartTemplateOnNewLine: true,
    sourceFile: params.sourceFile,
    targetCursorOffset: destination.targetCursorOffset,
    targetFile: destination.targetFile,
    targetSubpath: destination.targetSubpath
  });
  await composer.splitFile();
}
