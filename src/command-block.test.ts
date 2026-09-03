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
   * The Merge category's own visibility list (issue #249), which since issue #271 is the whole of what
   * decides whether a merge command is offered on a path.
   */
  readonly mergeCommandExcludePaths?: string[];

  /**
   * The Merge category's content filter, which must never decide command visibility on its own
   * (issue #198).
   */
  readonly mergeExcludePaths?: string[];
}

function createComponent(params: CreateComponentParams = {}): PluginSettingsComponent {
  const settings = new PluginSettings();
  settings.mergeCommandExcludePaths = params.mergeCommandExcludePaths ?? [];
  settings.mergeExcludePaths = params.mergeExcludePaths ?? [];
  return strictProxy<PluginSettingsComponent>({ settings });
}

function createContext(path: null | string): MarkdownFileInfo {
  const file = path === null ? null : strictProxy<TFile>({ path });
  return strictProxy<MarkdownFileInfo>({ file });
}

describe('isEditorCommandBlocked', () => {
  it('should block when the active path is in the command exclude paths', () => {
    const pluginSettingsComponent = createComponent({ mergeCommandExcludePaths: ['secret'] });
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext('secret/note.md'), pluginSettingsComponent })).toBe(true);
  });

  it('should not block when the active path is not in the command exclude paths', () => {
    const pluginSettingsComponent = createComponent({ mergeCommandExcludePaths: ['secret'] });
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext('public/note.md'), pluginSettingsComponent })).toBe(false);
  });

  it('should not block when the command exclude paths are empty', () => {
    const pluginSettingsComponent = createComponent();
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext('secret/note.md'), pluginSettingsComponent })).toBe(false);
  });

  // Issue #198: the two filters are independent, so merely excluding a path from merges/splits must NOT
  // Hide its commands — they stay visible and refuse with a notice on trigger.
  it('should not block a path that is only in the content exclude paths', () => {
    const pluginSettingsComponent = createComponent({ mergeExcludePaths: ['secret'] });
    expect(isEditorCommandBlocked({ commandCategory: CommandCategory.Merge, context: createContext('secret/note.md'), pluginSettingsComponent })).toBe(false);
  });

  it('should not block when there is no active file', () => {
    const pluginSettingsComponent = createComponent({ mergeCommandExcludePaths: ['secret'] });
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
    const pluginSettingsComponent = createComponent({ mergeCommandExcludePaths: ['secret'] });
    expect(
      isFileOrFolderCommandBlocked({
        abstractFile: strictProxy<TAbstractFile>({ path: 'secret/folder' }),
        commandCategory: CommandCategory.Merge,
        pluginSettingsComponent
      })
    ).toBe(true);
  });

  it('should not block when the path is not in the command exclude paths', () => {
    const pluginSettingsComponent = createComponent({ mergeCommandExcludePaths: ['secret'] });
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
    const pluginSettingsComponent = createComponent({ mergeExcludePaths: ['secret'] });
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
