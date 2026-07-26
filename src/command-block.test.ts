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

function createComponent(shouldBlock: boolean, excludePaths: string[]): PluginSettingsComponent {
  const settings = new PluginSettings();
  settings.shouldBlockCommandsOnExcludedPaths = shouldBlock;
  settings.excludePaths = excludePaths;
  return strictProxy<PluginSettingsComponent>({ settings });
}

function createCtx(path: null | string): MarkdownFileInfo {
  const file = path === null ? null : strictProxy<TFile>({ path });
  return strictProxy<MarkdownFileInfo>({ file });
}

describe('isEditorCommandBlocked', () => {
  it('should block when blocking is on and the active path is excluded', () => {
    const component = createComponent(true, ['secret']);
    expect(isEditorCommandBlocked(component, createCtx('secret/note.md'))).toBe(true);
  });

  it('should not block when blocking is on but the active path is not excluded', () => {
    const component = createComponent(true, ['secret']);
    expect(isEditorCommandBlocked(component, createCtx('public/note.md'))).toBe(false);
  });

  it('should not block when blocking is off even if the active path is excluded', () => {
    const component = createComponent(false, ['secret']);
    expect(isEditorCommandBlocked(component, createCtx('secret/note.md'))).toBe(false);
  });

  it('should not block when there is no active file', () => {
    const component = createComponent(true, ['secret']);
    expect(isEditorCommandBlocked(component, createCtx(null))).toBe(false);
  });
});

describe('isFileOrFolderCommandBlocked', () => {
  it('should block when blocking is on and the path is excluded', () => {
    const component = createComponent(true, ['secret']);
    expect(isFileOrFolderCommandBlocked(component, strictProxy<TAbstractFile>({ path: 'secret/folder' }))).toBe(true);
  });

  it('should not block when blocking is on but the path is not excluded', () => {
    const component = createComponent(true, ['secret']);
    expect(isFileOrFolderCommandBlocked(component, strictProxy<TAbstractFile>({ path: 'public/folder' }))).toBe(false);
  });

  it('should not block when blocking is off even if the path is excluded', () => {
    const component = createComponent(false, ['secret']);
    expect(isFileOrFolderCommandBlocked(component, strictProxy<TAbstractFile>({ path: 'secret/folder' }))).toBe(false);
  });
});
