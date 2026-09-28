/**
 * @file
 *
 * Templater's `tp.file.cursor()` in a note this plugin had Templater render in the background (issue #301).
 *
 * `tp.file.cursor()` does not move anything when it renders: it renders to its own MARKER,
 * `<% tp.file.cursor() %>`, and Templater consumes that marker afterwards with a separate cursor jump that
 * acts on the ACTIVE editor only. Templater's own entry points jump right after they render, because the note
 * they render is the one on screen. This plugin renders its destinations inside an operation, before the note
 * is opened (and often without ever opening it), so that jump never fired and the marker stayed in the note as
 * raw text — which the reporter read as "Templater does not trigger", although every other command in the same
 * template had rendered.
 *
 * So a note Templater rendered while it was NOT the active note, and that still holds a marker, is remembered
 * here, and the jump runs the next time the note is opened: straight away when the operation opens it itself,
 * on the notice link's click, or whenever the user opens it later. That is the moment Templater would have
 * jumped had it created the note on screen, and it is the jump TEMPLATER's own code performs, so its
 * `Automatic jump to cursor` setting is honored and several markers are walked exactly as it walks them.
 *
 * Stripping the marker instead was rejected: it would throw away where the template's author asked the caret to
 * go, for a note the user has not opened yet.
 *
 * The set holds `TFile` references rather than paths: a note renamed before it is opened is still the same
 * object, and a note that was trashed simply never opens. It is session-only, like the recent-target log, and
 * cleared on unload.
 */

import type {
  App,
  TFile
} from 'obsidian';

/**
 * The marker `tp.file.cursor()` renders to, with its optional order argument — the pattern Templater's own
 * cursor jump searches for (Templater 2.25.0, `CursorJumper.get_cursor_matches_and_positions`).
 */
const TEMPLATER_CURSOR_MARKER_REG_EXP = /<%\s*tp\.file\.cursor\((?:-?\d+(?:\.\d+)?)?\)\s*%>/;

const filesWithPendingCursor = new Set<TFile>();

/**
 * Forgets every pending cursor. The set is session-only, so the plugin clears it on unload.
 */
export function clearPendingTemplaterCursors(): void {
  filesWithPendingCursor.clear();
}

/**
 * Checks whether a text holds a `tp.file.cursor()` marker Templater has not consumed yet.
 *
 * @param content - The text to check.
 * @returns `true` if the text holds a marker.
 */
export function hasTemplaterCursorMarker(content: string): boolean {
  return TEMPLATER_CURSOR_MARKER_REG_EXP.test(content);
}

/**
 * Runs Templater's cursor jump in a note that was just opened, if Templater left a marker in it while it was
 * rendered in the background. Called on every `file-open`; a note nothing was recorded for costs one set lookup.
 *
 * The note is forgotten once the jump runs. It is KEPT when the opened editor does not show the marker yet while
 * the file on disk still holds it — the editor had not caught up with the file, and the next open gets another
 * chance — and forgotten when the file no longer holds one at all (the user already removed it).
 *
 * @param app - The Obsidian app instance.
 * @param file - The note that was opened.
 * @returns A {@link Promise} that resolves once the jump has run or been ruled out.
 */
export async function jumpToPendingTemplaterCursor(app: App, file: TFile): Promise<void> {
  if (!filesWithPendingCursor.has(file)) {
    return;
  }

  const templaterPlugin = app.plugins.plugins['templater-obsidian'];
  if (!templaterPlugin) {
    filesWithPendingCursor.delete(file);
    return;
  }

  const editorContent = app.workspace.activeEditor?.editor?.getValue() ?? '';
  if (!hasTemplaterCursorMarker(editorContent)) {
    if (!hasTemplaterCursorMarker(await app.vault.read(file))) {
      filesWithPendingCursor.delete(file);
    }
    return;
  }

  filesWithPendingCursor.delete(file);
  await templaterPlugin.editor_handler.jump_to_next_cursor_location(file, true);
}

/**
 * Remembers a note Templater has just rendered, so its `tp.file.cursor()` marker is consumed when the note is
 * next opened (see the file comment).
 *
 * Nothing is recorded for the ACTIVE note — Templater jumps in that one itself — or for a note holding no marker.
 *
 * @param app - The Obsidian app instance.
 * @param file - The note Templater rendered.
 * @returns A {@link Promise} that resolves once the note has been checked.
 */
export async function recordPendingTemplaterCursor(app: App, file: TFile): Promise<void> {
  if (app.workspace.getActiveFile() === file) {
    return;
  }

  if (hasTemplaterCursorMarker(await app.vault.read(file))) {
    filesWithPendingCursor.add(file);
  }
}
