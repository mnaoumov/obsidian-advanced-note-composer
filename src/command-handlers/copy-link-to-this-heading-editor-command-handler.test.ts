import type { HeadingInfo } from '@obsidian-typings/obsidian-public-latest/implementations';
import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
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
import { resolveEnclosingHeadingInfo } from '../select-ranges.ts';
import { CopyLinkToThisHeadingEditorCommandHandler } from './copy-link-to-this-heading-editor-command-handler.ts';

vi.mock('../select-ranges.ts', () => ({
  resolveEnclosingHeadingInfo: vi.fn()
}));

const mockResolveEnclosingHeadingInfo = vi.mocked(resolveEnclosingHeadingInfo);

const FILE = strictProxy<TFile>({ path: 'test/note.md' });

const HEADING_INFO: HeadingInfo = {
  end: { ch: 12, line: 9 },
  heading: '[Section] one',
  start: { ch: 0, line: 3 }
};

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
  const generateMarkdownLink = vi.fn().mockReturnValue('[[#Section one]]');
  const showNotice = vi.fn();
  const handler = castTo<TestableHandler>(
    new CopyLinkToThisHeadingEditorCommandHandler({
      app: strictProxy<App>({ fileManager: { generateMarkdownLink } }),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    })
  );
  return { generateMarkdownLink, handler, showNotice };
}

describe('CopyLinkToThisHeadingEditorCommandHandler', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const editor = strictProxy<Editor>({});

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(activeWindow.navigator, 'clipboard', { configurable: true, value: castTo<Clipboard>({ writeText }) });
  });

  it('should construct with correct params', () => {
    const { handler } = createHarness();
    expect(handler.id).toBe('copy-link-to-this-heading');
    expect(handler.name).toBe('Copy link to this heading');
    expect(handler.icon).toBe('lucide-link');
  });

  it('is unavailable with no file in context', () => {
    expect(createHarness().handler.canExecuteEditor(editor, createContext(null))).toBe(false);
    expect(mockResolveEnclosingHeadingInfo).not.toHaveBeenCalled();
  });

  it('is unavailable when the cursor is under no heading', () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(null);
    expect(createHarness().handler.canExecuteEditor(editor, createContext())).toBe(false);
  });

  it('is available under a heading', () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(HEADING_INFO);
    expect(createHarness().handler.canExecuteEditor(editor, createContext())).toBe(true);
  });

  it('copies Obsidian\'s own link to the enclosing heading, from the note it sits in', async () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(HEADING_INFO);
    const { generateMarkdownLink, handler, showNotice } = createHarness();

    await handler.executeEditor(editor, createContext());

    // The subpath is the heading as a link writes it (the brackets dropped), and the source path is the note
    // itself, so the link takes the same-note form.
    expect(generateMarkdownLink).toHaveBeenCalledWith(FILE, 'test/note.md', '#Section one');
    expect(writeText).toHaveBeenCalledWith('[[#Section one]]');
    expect(showNotice).toHaveBeenCalledWith('Copied [[#Section one]]');
  });

  it('copies nothing when the cursor is under no heading', async () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(null);
    const { handler, showNotice } = createHarness();

    await handler.executeEditor(editor, createContext());

    expect(writeText).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });
});
