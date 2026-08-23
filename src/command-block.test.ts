import type {
  MarkdownFileInfo,
  TAbstractFile,
  TFile
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  isEditorCommandBlocked,
  isFileOrFolderCommandBlocked
} from './command-block.ts';
import {
  CommandCategory,
  PluginSettings
} from './plugin-settings.ts';

interface CreateComponentParams {
  /**
   * The baseline list that covers every command.
   */
  readonly commandExcludePaths?: string[];

  /**
   * The content filter, which must never decide command visibility on its own (issue #198).
   */
  readonly excludePaths?: string[];

  /**
   * One category's own list, used to prove the helpers pass the asking command's category through
   * (issue #249).
   */
  readonly mergeCommandExcludePaths?: string[];
}

function createComponent(params: CreateComponentParams = {}): PluginSettingsComponent {
  const settings = new PluginSettings();
  settings.commandExcludePaths = params.commandExcludePaths ?? [];
  settings.excludePaths = params.excludePaths ?? [];
  settings.mergeCommandExcludePaths = params.mergeCommandExcludePaths ?? [];
  return strictProxy<PluginSettingsComponent>({ settings });
}

function createContext(path: null | string): MarkdownFileInfo {
  const file = path === null ? null : strictProxy<TFile>({ path });
  return strictProxy<MarkdownFileInfo>({ file });
}

describe('isEditorCommandBlocked', () => {
  it('should block when the active path is in the command exclude paths', () => {
    const pluginSettingsComponent = createComponent({ commandExcludePaths: ['secret'] });
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext('secret/note.md'), pluginSettingsComponent })).toBe(true);
  });

  it('should not block when the active path is not in the command exclude paths', () => {
    const pluginSettingsComponent = createComponent({ commandExcludePaths: ['secret'] });
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext('public/note.md'), pluginSettingsComponent })).toBe(false);
  });

  it('should not block when the command exclude paths are empty', () => {
    const pluginSettingsComponent = createComponent();
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext('secret/note.md'), pluginSettingsComponent })).toBe(false);
  });

  // Issue #198: the two filters are independent, so merely excluding a path from merges/splits must NOT
  // Hide its commands — they stay visible and refuse with a notice on trigger.
  it('should not block a path that is only in the content exclude paths', () => {
    const pluginSettingsComponent = createComponent({ excludePaths: ['secret'] });
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext('secret/note.md'), pluginSettingsComponent })).toBe(false);
  });

  it('should not block when there is no active file', () => {
    const pluginSettingsComponent = createComponent({ commandExcludePaths: ['secret'] });
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext(null), pluginSettingsComponent })).toBe(false);
  });

  // Issue #249: the helper must hand the asking command's category to the settings, or every command
  // Would keep sharing one answer.
  it('should block only the category whose own exclude paths cover the active path', () => {
    const pluginSettingsComponent = createComponent({ mergeCommandExcludePaths: ['secret'] });
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext('secret/note.md'), pluginSettingsComponent })).toBe(true);
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Reorder, context: createContext('secret/note.md'), pluginSettingsComponent })).toBe(false);
  });
});

describe('isFileOrFolderCommandBlocked', () => {
  it('should block when the path is in the command exclude paths', () => {
    const pluginSettingsComponent = createComponent({ commandExcludePaths: ['secret'] });
    expect(
      isFileOrFolderCommandBlocked({
        abstractFile: strictProxy<TAbstractFile>({ path: 'secret/folder' }),
        commandCategory: CommandCategory.Merge,
        pluginSettingsComponent
      })
    ).toBe(true);
  });

  it('should not block when the path is not in the command exclude paths', () => {
    const pluginSettingsComponent = createComponent({ commandExcludePaths: ['secret'] });
    expect(
      isFileOrFolderCommandBlocked({
        abstractFile: strictProxy<TAbstractFile>({ path: 'public/folder' }),
        commandCategory: CommandCategory.Merge,
        pluginSettingsComponent
      })
    ).toBe(false);
  });

  it('should not block when the command exclude paths are empty', () => {
    const pluginSettingsComponent = createComponent();
    expect(
      isFileOrFolderCommandBlocked({
        abstractFile: strictProxy<TAbstractFile>({ path: 'secret/folder' }),
        commandCategory: CommandCategory.Merge,
        pluginSettingsComponent
      })
    ).toBe(false);
  });

  it('should not block a path that is only in the content exclude paths', () => {
    const pluginSettingsComponent = createComponent({ excludePaths: ['secret'] });
    expect(
      isFileOrFolderCommandBlocked({
        abstractFile: strictProxy<TAbstractFile>({ path: 'secret/folder' }),
        commandCategory: CommandCategory.Merge,
        pluginSettingsComponent
      })
    ).toBe(false);
  });

  it('should block only the category whose own exclude paths cover the path', () => {
    const pluginSettingsComponent = createComponent({ mergeCommandExcludePaths: ['secret'] });
    const abstractFile = strictProxy<TAbstractFile>({ path: 'secret/folder' });
    expect(isFileOrFolderCommandBlocked({ abstractFile, commandCategory: CommandCategory.Merge, pluginSettingsComponent })).toBe(true);
    expect(isFileOrFolderCommandBlocked({ abstractFile, commandCategory: CommandCategory.Rename, pluginSettingsComponent })).toBe(false);
  });
});
