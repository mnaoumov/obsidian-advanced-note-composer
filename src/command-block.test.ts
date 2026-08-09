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
import { PluginSettings } from './plugin-settings.ts';

function createComponent(commandExcludePaths: string[], excludePaths: string[] = []): PluginSettingsComponent {
  const settings = new PluginSettings();
  settings.commandExcludePaths = commandExcludePaths;
  settings.excludePaths = excludePaths;
  return strictProxy<PluginSettingsComponent>({ settings });
}

function createContext(path: null | string): MarkdownFileInfo {
  const file = path === null ? null : strictProxy<TFile>({ path });
  return strictProxy<MarkdownFileInfo>({ file });
}

describe('isEditorCommandBlocked', () => {
  it('should block when the active path is in the command exclude paths', () => {
    const component = createComponent(['secret']);
    expect(isEditorCommandBlocked(component, createContext('secret/note.md'))).toBe(true);
  });

  it('should not block when the active path is not in the command exclude paths', () => {
    const component = createComponent(['secret']);
    expect(isEditorCommandBlocked(component, createContext('public/note.md'))).toBe(false);
  });

  it('should not block when the command exclude paths are empty', () => {
    const component = createComponent([]);
    expect(isEditorCommandBlocked(component, createContext('secret/note.md'))).toBe(false);
  });

  // Issue #198: the two filters are independent, so merely excluding a path from merges/splits must NOT
  // Hide its commands — they stay visible and refuse with a notice on trigger.
  it('should not block a path that is only in the content exclude paths', () => {
    const component = createComponent([], ['secret']);
    expect(isEditorCommandBlocked(component, createContext('secret/note.md'))).toBe(false);
  });

  it('should not block when there is no active file', () => {
    const component = createComponent(['secret']);
    expect(isEditorCommandBlocked(component, createContext(null))).toBe(false);
  });
});

describe('isFileOrFolderCommandBlocked', () => {
  it('should block when the path is in the command exclude paths', () => {
    const component = createComponent(['secret']);
    expect(isFileOrFolderCommandBlocked(component, strictProxy<TAbstractFile>({ path: 'secret/folder' }))).toBe(true);
  });

  it('should not block when the path is not in the command exclude paths', () => {
    const component = createComponent(['secret']);
    expect(isFileOrFolderCommandBlocked(component, strictProxy<TAbstractFile>({ path: 'public/folder' }))).toBe(false);
  });

  it('should not block when the command exclude paths are empty', () => {
    const component = createComponent([]);
    expect(isFileOrFolderCommandBlocked(component, strictProxy<TAbstractFile>({ path: 'secret/folder' }))).toBe(false);
  });

  it('should not block a path that is only in the content exclude paths', () => {
    const component = createComponent([], ['secret']);
    expect(isFileOrFolderCommandBlocked(component, strictProxy<TAbstractFile>({ path: 'secret/folder' }))).toBe(false);
  });
});
