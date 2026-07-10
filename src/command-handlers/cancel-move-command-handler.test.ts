import type {
  Notice,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import { CancelMoveCommandHandler } from './cancel-move-command-handler.ts';

interface CreateHandlerResult {
  readonly handler: TestableHandler;
  showNotice(): void;
}

interface TestableHandler {
  canExecute(): boolean;
  execute(): void;
  readonly id: string;
  readonly name: string;
}

function createHandler(moveSelectionBuffer: MoveSelectionBuffer, showNotice = vi.fn()): CreateHandlerResult {
  const handler = new CancelMoveCommandHandler({
    moveSelectionBuffer,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice })
  });
  return { handler: castTo<TestableHandler>(handler), showNotice };
}

function createMarkedBuffer(): MoveSelectionBuffer {
  const buffer = new MoveSelectionBuffer();
  buffer.mark({
    abortController: new AbortController(),
    capturedSelections: [{ endOffset: 1, startOffset: 0 }],
    lock: { [Symbol.dispose]: vi.fn() },
    notice: strictProxy<Notice>({ hide: vi.fn() }),
    selectedText: 'text',
    sourceFile: strictProxy<TFile>({ path: 'source.md' }),
    sourceMtime: 1
  });
  return buffer;
}

describe('CancelMoveCommandHandler', () => {
  it('should construct with correct id and name', () => {
    const { handler } = createHandler(new MoveSelectionBuffer());
    expect(handler.id).toBe('cancel-move');
    expect(handler.name).toBe('Smart cut & paste: Cancel move');
  });

  it('should be unavailable when nothing is marked', () => {
    const { handler } = createHandler(new MoveSelectionBuffer());
    expect(handler.canExecute()).toBe(false);
  });

  it('should be available when something is marked', () => {
    const { handler } = createHandler(createMarkedBuffer());
    expect(handler.canExecute()).toBe(true);
  });

  it('should clear the mark and show a notice on execute', () => {
    const buffer = createMarkedBuffer();
    const { handler, showNotice } = createHandler(buffer);

    handler.execute();

    expect(buffer.hasMark()).toBe(false);
    expect(showNotice).toHaveBeenCalledTimes(1);
  });
});
