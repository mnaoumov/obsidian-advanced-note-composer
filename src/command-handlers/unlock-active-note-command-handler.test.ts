import type {
  App,
  Notice,
  TFile,
  Workspace
} from 'obsidian';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  isResourceLockedForPath,
  requestResourceUnlockForPath
} from 'obsidian-dev-utils/obsidian/resource-lock';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import { UnlockActiveNoteCommandHandler } from './unlock-active-note-command-handler.ts';

vi.mock('obsidian-dev-utils/obsidian/resource-lock', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/obsidian/resource-lock')>(),
  isResourceLockedForPath: vi.fn(),
  requestResourceUnlockForPath: vi.fn()
}));

interface TestableHandler {
  canExecute(): boolean;
  execute(): void;
  readonly id: string;
  readonly name: string;
}

const ACTIVE_FILE = strictProxy<TFile>({ path: 'active.md' });

interface HandlerParams {
  readonly app: App;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly resourceLockComponent: ResourceLockComponent;
}

function createParams(activeFile: null | TFile = ACTIVE_FILE, isMutationBlockedByAncestor = false): HandlerParams {
  return {
    app: strictProxy<App>({
      workspace: strictProxy<Workspace>({
        getActiveFile: vi.fn().mockReturnValue(activeFile)
      })
    }),
    moveSelectionBuffer: new MoveSelectionBuffer(),
    resourceLockComponent: strictProxy<ResourceLockComponent>({
      isMutationBlockedByAncestorForPath: vi.fn().mockReturnValue(isMutationBlockedByAncestor)
    })
  };
}

function markBuffer(buffer: MoveSelectionBuffer): AbortController {
  const abortController = new AbortController();
  buffer.mark({
    abortController,
    capturedSelections: [{ endOffset: 1, startOffset: 0 }],
    lock: { [Symbol.dispose]: vi.fn() },
    notice: strictProxy<Notice>({ hide: vi.fn() }),
    selectedText: 'text',
    sourceFile: strictProxy<TFile>({ path: 'source.md' }),
    sourceMtime: 1
  });
  return abortController;
}

function toTestable(params: HandlerParams): TestableHandler {
  return castTo<TestableHandler>(new UnlockActiveNoteCommandHandler(params));
}

describe('UnlockActiveNoteCommandHandler', () => {
  beforeEach(() => {
    vi.mocked(isResourceLockedForPath).mockReset();
    vi.mocked(requestResourceUnlockForPath).mockReset();
  });

  it('should construct with correct id and name', () => {
    const handler = toTestable(createParams());
    expect(handler.id).toBe('unlock-active-note');
    expect(handler.name).toBe('Unlock active note');
  });

  describe('canExecute', () => {
    it('should be unavailable when there is no active file', () => {
      expect(toTestable(createParams(null)).canExecute()).toBe(false);
    });

    it('should be available when the active file is directly locked', () => {
      vi.mocked(isResourceLockedForPath).mockReturnValue(true);
      expect(toTestable(createParams()).canExecute()).toBe(true);
    });

    it('should be available when the active file is covered by an all-notes mark lock', () => {
      vi.mocked(isResourceLockedForPath).mockReturnValue(false);
      const params = createParams(ACTIVE_FILE, true);
      markBuffer(params.moveSelectionBuffer);
      expect(toTestable(params).canExecute()).toBe(true);
    });

    it('should be unavailable when the active file is not locked and nothing is marked', () => {
      vi.mocked(isResourceLockedForPath).mockReturnValue(false);
      expect(toTestable(createParams(ACTIVE_FILE, true)).canExecute()).toBe(false);
    });

    it('should be unavailable when marked but the active file is not covered by the mark lock', () => {
      vi.mocked(isResourceLockedForPath).mockReturnValue(false);
      const params = createParams(ACTIVE_FILE, false);
      markBuffer(params.moveSelectionBuffer);
      expect(toTestable(params).canExecute()).toBe(false);
    });
  });

  describe('execute', () => {
    it('should be a no-op when there is no active file', () => {
      toTestable(createParams(null)).execute();
      expect(requestResourceUnlockForPath).not.toHaveBeenCalled();
    });

    it('should request an unlock of the directly locked active file', () => {
      vi.mocked(isResourceLockedForPath).mockReturnValue(true);
      toTestable(createParams()).execute();
      expect(requestResourceUnlockForPath).toHaveBeenCalledWith(expect.anything(), ACTIVE_FILE);
    });

    it('should abort the mark controller when the active file is covered only by the all-notes mark lock', () => {
      vi.mocked(isResourceLockedForPath).mockReturnValue(false);
      const params = createParams(ACTIVE_FILE, true);
      const abortController = markBuffer(params.moveSelectionBuffer);

      toTestable(params).execute();

      expect(abortController.signal.aborted).toBe(true);
      expect(requestResourceUnlockForPath).not.toHaveBeenCalled();
    });

    it('should be a no-op when the active file is not locked and nothing is marked', () => {
      vi.mocked(isResourceLockedForPath).mockReturnValue(false);
      const params = createParams();
      expect(() => {
        toTestable(params).execute();
      }).not.toThrow();
      expect(requestResourceUnlockForPath).not.toHaveBeenCalled();
    });
  });
});
