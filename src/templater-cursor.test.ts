import type {
  App as AppOriginal,
  TFile
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  clearPendingTemplaterCursors,
  hasTemplaterCursorMarker,
  jumpToPendingTemplaterCursor,
  recordPendingTemplaterCursor
} from './templater-cursor.ts';

interface CreateContextOptions {
  readonly shouldInstallTemplater?: boolean;
}

interface PluginsRegistryTestable {
  registerPlugin__: (id: string, plugin: unknown) => void;
}

interface TestContext {
  readonly app: AppOriginal;
  readonly jump: ReturnType<typeof vi.fn>;
  readonly marked: TFile;
  readonly plain: TFile;
  readonly setActive: (file: null | TFile, editorContent?: string) => void;
}

const MARKED_CONTENT = 'before <% tp.file.cursor() %> after';

beforeEach(() => {
  clearPendingTemplaterCursors();
});

describe('hasTemplaterCursorMarker', () => {
  it('should recognize every form of the marker Templater renders', () => {
    expect(hasTemplaterCursorMarker('<% tp.file.cursor() %>')).toBe(true);
    expect(hasTemplaterCursorMarker('<%tp.file.cursor(2)%>')).toBe(true);
    expect(hasTemplaterCursorMarker('<% tp.file.cursor(-1.5) %>')).toBe(true);
  });

  it('should not mistake other Templater commands for it', () => {
    expect(hasTemplaterCursorMarker('<% tp.file.title %>')).toBe(false);
    expect(hasTemplaterCursorMarker('tp.file.cursor()')).toBe(false);
    expect(hasTemplaterCursorMarker('')).toBe(false);
  });
});

describe('jumpToPendingTemplaterCursor', () => {
  it('should jump once, with Templater\'s own auto-jump flag, when a recorded note opens holding the marker', async () => {
    const context = createContext();
    context.setActive(null);
    await recordPendingTemplaterCursor(context.app, context.marked);

    context.setActive(context.marked, MARKED_CONTENT);
    await jumpToPendingTemplaterCursor(context.app, context.marked);
    await jumpToPendingTemplaterCursor(context.app, context.marked);

    expect(context.jump.mock.calls).toEqual([[context.marked, true]]);
  });

  it('should do nothing for a note that was never recorded', async () => {
    const context = createContext();
    context.setActive(context.marked, MARKED_CONTENT);

    await jumpToPendingTemplaterCursor(context.app, context.marked);

    expect(context.jump).not.toHaveBeenCalled();
  });

  it('should record nothing for the active note, where Templater has jumped already', async () => {
    const context = createContext();
    context.setActive(context.marked, MARKED_CONTENT);

    await recordPendingTemplaterCursor(context.app, context.marked);
    await jumpToPendingTemplaterCursor(context.app, context.marked);

    expect(context.jump).not.toHaveBeenCalled();
  });

  it('should record nothing for a note without a marker', async () => {
    const context = createContext();
    context.setActive(null);

    await recordPendingTemplaterCursor(context.app, context.plain);
    context.setActive(context.plain, MARKED_CONTENT);
    await jumpToPendingTemplaterCursor(context.app, context.plain);

    expect(context.jump).not.toHaveBeenCalled();
  });

  it('should keep the note pending while its editor has not caught up with the file', async () => {
    const context = createContext();
    context.setActive(null);
    await recordPendingTemplaterCursor(context.app, context.marked);

    // No editor at all (reading view), then an editor still showing nothing.
    context.setActive(context.marked);
    await jumpToPendingTemplaterCursor(context.app, context.marked);
    context.setActive(context.marked, '');
    await jumpToPendingTemplaterCursor(context.app, context.marked);
    expect(context.jump).not.toHaveBeenCalled();

    context.setActive(context.marked, MARKED_CONTENT);
    await jumpToPendingTemplaterCursor(context.app, context.marked);
    expect(context.jump).toHaveBeenCalledTimes(1);
  });

  it('should forget the note once the file no longer holds a marker', async () => {
    const context = createContext();
    context.setActive(null);
    await recordPendingTemplaterCursor(context.app, context.marked);
    await context.app.vault.modify(context.marked, 'the user removed it');

    context.setActive(context.marked, '');
    await jumpToPendingTemplaterCursor(context.app, context.marked);
    await context.app.vault.modify(context.marked, MARKED_CONTENT);
    context.setActive(context.marked, MARKED_CONTENT);
    await jumpToPendingTemplaterCursor(context.app, context.marked);

    expect(context.jump).not.toHaveBeenCalled();
  });

  it('should forget the note when Templater is gone by the time it opens', async () => {
    const context = createContext({ shouldInstallTemplater: false });
    context.setActive(null);
    await recordPendingTemplaterCursor(context.app, context.marked);

    context.setActive(context.marked, MARKED_CONTENT);
    await jumpToPendingTemplaterCursor(context.app, context.marked);
    castTo<PluginsRegistryTestable>(context.app.plugins).registerPlugin__('templater-obsidian', {
      // eslint-disable-next-line camelcase -- Templater's own API property name.
      editor_handler: { jump_to_next_cursor_location: context.jump }
    });
    await jumpToPendingTemplaterCursor(context.app, context.marked);

    expect(context.jump).not.toHaveBeenCalled();
  });

  it('should forget everything on clear', async () => {
    const context = createContext();
    context.setActive(null);
    await recordPendingTemplaterCursor(context.app, context.marked);

    clearPendingTemplaterCursors();
    context.setActive(context.marked, MARKED_CONTENT);
    await jumpToPendingTemplaterCursor(context.app, context.marked);

    expect(context.jump).not.toHaveBeenCalled();
  });
});

function createContext(options: CreateContextOptions = {}): TestContext {
  const app = App.createConfigured__({ files: { 'marked.md': MARKED_CONTENT, 'plain.md': 'plain' } }).asOriginalType__();
  const jump = vi.fn().mockResolvedValue(undefined);
  if (options.shouldInstallTemplater ?? true) {
    castTo<PluginsRegistryTestable>(app.plugins).registerPlugin__('templater-obsidian', {
      // eslint-disable-next-line camelcase -- Templater's own API property name.
      editor_handler: { jump_to_next_cursor_location: jump }
    });
  }
  const activeFileSpy = vi.spyOn(app.workspace, 'getActiveFile');

  return {
    app,
    jump,
    marked: ensureNonNullable(app.vault.getFileByPath('marked.md')),
    plain: ensureNonNullable(app.vault.getFileByPath('plain.md')),
    setActive(file: null | TFile, editorContent?: string): void {
      activeFileSpy.mockReturnValue(file);
      Object.defineProperty(app.workspace, 'activeEditor', {
        configurable: true,
        value: editorContent === undefined ? null : { editor: { getValue: (): string => editorContent } }
      });
    }
  };
}
