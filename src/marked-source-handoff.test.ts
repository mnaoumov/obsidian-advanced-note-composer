import type {
  App as AppOriginal,
  Editor,
  MarkdownView,
  Notice,
  TFile,
  WorkspaceLeaf
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { reopenMarkedSourceNote } from './marked-source-handoff.ts';
import { MoveSelectionBuffer } from './move-selection-buffer.ts';

const SOURCE_FILE: TFile = strictProxy<TFile>({ path: 'source.md' });

let app: AppOriginal;
let moveSelectionBuffer: MoveSelectionBuffer;
let pluginNoticeComponent: PluginNoticeComponent;

beforeEach(() => {
  app = App.createConfigured__({}).asOriginalType__();
  moveSelectionBuffer = new MoveSelectionBuffer();
  pluginNoticeComponent = strictProxy<PluginNoticeComponent>({
    showNotice: vi.fn().mockReturnValue(strictProxy<Notice>({ hide: vi.fn() }))
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function markSource(sourceFile: TFile = SOURCE_FILE): void {
  moveSelectionBuffer.mark({
    abortController: new AbortController(),
    capturedSelections: [{ endOffset: 10, startOffset: 0 }],
    highlight: { [Symbol.dispose]: vi.fn() },
    lock: { [Symbol.dispose]: vi.fn() },
    markedHeading: { line: 3, text: 'Marked heading' },
    notice: strictProxy<Notice>({ hide: vi.fn() }),
    selectedText: '## Marked heading',
    sourceFile,
    sourceMtime: 1
  });
}

function reopen(): Promise<MarkdownView | null> {
  return reopenMarkedSourceNote({ app, moveSelectionBuffer, pluginNoticeComponent });
}

function stubActiveView(viewFile: null | TFile): WorkspaceLeaf['openFile'] {
  const openFile = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(app.vault, 'getFileByPath').mockReturnValue(SOURCE_FILE);
  vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(strictProxy<WorkspaceLeaf>({ openFile }));
  vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
    viewFile === null ? null : strictProxy<MarkdownView>({ editor: strictProxy<Editor>({}), file: viewFile })
  );
  return openFile;
}

describe('reopenMarkedSourceNote', () => {
  it('should do nothing when nothing is marked', async () => {
    const getLeafSpy = vi.spyOn(app.workspace, 'getLeaf');

    expect(await reopen()).toBeNull();
    expect(getLeafSpy).not.toHaveBeenCalled();
  });

  it('should notice and drop the mark when the marked note no longer exists', async () => {
    markSource(strictProxy<TFile>({ path: 'ghost.md' }));
    vi.spyOn(app.vault, 'getFileByPath').mockReturnValue(null);

    expect(await reopen()).toBeNull();
    expect(vi.mocked(pluginNoticeComponent.showNotice)).toHaveBeenCalledWith('The note the selection was marked in no longer exists.');
    expect(moveSelectionBuffer.hasMark()).toBe(false);
  });

  it('should release the mark and return the re-opened source note view', async () => {
    markSource();
    const openFile = stubActiveView(SOURCE_FILE);

    const view = await reopen();

    expect(view).not.toBeNull();
    expect(openFile).toHaveBeenCalledWith(SOURCE_FILE, { active: true });
    // The mark's mutation-blocking lock is what the caller needs released before it writes to the note.
    expect(moveSelectionBuffer.hasMark()).toBe(false);
  });

  it('should return null when no markdown view becomes active', async () => {
    markSource();
    stubActiveView(null);

    expect(await reopen()).toBeNull();
    expect(moveSelectionBuffer.hasMark()).toBe(false);
  });

  it('should return null when the active view shows a different note', async () => {
    markSource();
    stubActiveView(strictProxy<TFile>({ path: 'other.md' }));

    expect(await reopen()).toBeNull();
  });
});
