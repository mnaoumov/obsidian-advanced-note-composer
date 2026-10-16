import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { CommandMenuPlacement } from '../plugin-settings.ts';
import { CopyLinkToThisFileEditorCommandHandler } from './copy-link-to-this-file-editor-command-handler.ts';

const FILE = strictProxy<TFile>({ path: 'test/note.md' });

interface Harness {
  readonly generateMarkdownLink: ReturnType<typeof vi.fn>;
  readonly handler: TestableHandler;
  readonly showNotice: ReturnType<typeof vi.fn>;
}

interface TestableHandler {
  canExecuteEditor: (editor: Editor, context: MarkdownFileInfo) => boolean;
  executeEditor: (editor: Editor, context: MarkdownFileInfo) => Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
}

function createContext(file: null | TFile = FILE): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createHarness(): Harness {
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(false)
  });
  const generateMarkdownLink = vi.fn().mockReturnValue('[[note]]');
  const showNotice = vi.fn();
  const handler = castTo<TestableHandler>(
    new CopyLinkToThisFileEditorCommandHandler({
      app: strictProxy<App>({ fileManager: { generateMarkdownLink } }),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    })
  );
  return { generateMarkdownLink, handler, showNotice };
}

describe('CopyLinkToThisFileEditorCommandHandler', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const editor = strictProxy<Editor>({});

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(activeWindow.navigator, 'clipboard', { configurable: true, value: castTo<Clipboard>({ writeText }) });
  });

  it('should construct with correct params', () => {
    const { handler } = createHarness();
    expect(handler.id).toBe('copy-link-to-this-file');
    expect(handler.name).toBe('Copy link to this file');
    expect(handler.icon).toBe('lucide-link');
  });

  it('is unavailable with no file in context', () => {
    expect(createHarness().handler.canExecuteEditor(editor, createContext(null))).toBe(false);
  });

  it('is available with a file in context', () => {
    expect(createHarness().handler.canExecuteEditor(editor, createContext())).toBe(true);
  });

  it('copies Obsidian\'s own link to the note, from the note itself', async () => {
    const { generateMarkdownLink, handler, showNotice } = createHarness();

    await handler.executeEditor(editor, createContext());

    expect(generateMarkdownLink).toHaveBeenCalledWith(FILE, 'test/note.md');
    expect(writeText).toHaveBeenCalledWith('[[note]]');
    expect(showNotice).toHaveBeenCalledWith('Copied [[note]]');
  });

  it('copies nothing with no file in context', async () => {
    const { handler, showNotice } = createHarness();

    await handler.executeEditor(editor, createContext(null));

    expect(writeText).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });
});
