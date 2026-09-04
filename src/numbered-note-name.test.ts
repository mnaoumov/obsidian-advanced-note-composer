import type {
  App as AppOriginal,
  TFile,
  TFolder
} from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { PluginSettings } from './plugin-settings.ts';

import { applyNumberedNoteName } from './numbered-note-name.ts';

function createPluginSettingsComponent(numberedSplitNoteNameTemplate: string): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: castTo<PluginSettings>({ numberedSplitNoteNameTemplate })
  });
}

/**
 * Renumbers `parent/D.md` in a vault built from `files`, and reports the path it ended up at.
 *
 * @param files - The vault contents, which must include the note being renumbered.
 * @param numberedSplitNoteNameTemplate - The template under test.
 * @param notePath - The note to renumber.
 * @returns The note's path after the rename.
 */
async function renumber(
  files: Record<string, string>,
  numberedSplitNoteNameTemplate: string,
  notePath = 'parent/D.md'
): Promise<string> {
  const app = App.createConfigured__({ files }).asOriginalType__();
  const file = ensureNonNullable(app.vault.getFileByPath(notePath));
  await applyNumberedNoteName({
    app,
    file,
    pluginSettingsComponent: createPluginSettingsComponent(numberedSplitNoteNameTemplate)
  });
  return file.path;
}

describe('applyNumberedNoteName', () => {
  it('should continue the reporter\'s own gapped sequence at 1 + max', async () => {
    // Issue #269's example verbatim, for the flat (no own folder) case.
    expect(
      await renumber({
        'parent/1. A.md': 'a',
        'parent/3. B.md': 'b',
        'parent/4. C.md': 'c',
        'parent/D.md': 'd'
      }, '{{index}}. {{safeName}}')
    ).toBe('parent/5. D.md');
  });

  it('should start at 1 when no sibling note is numbered', async () => {
    expect(
      await renumber({
        'parent/Alpha.md': 'a',
        'parent/D.md': 'd'
      }, '{{index}}. {{safeName}}')
    ).toBe('parent/1. D.md');
  });

  it('should leave the note alone when the template is empty, which is the opt-out', async () => {
    expect(
      await renumber({
        'parent/1. A.md': 'a',
        'parent/D.md': 'd'
      }, '')
    ).toBe('parent/D.md');
  });

  it('should zero-pad to the width of the mask', async () => {
    expect(
      await renumber({
        'parent/006 D.md': 'six',
        'parent/D.md': 'd'
      }, '{{index:000}} {{safeName}}')
    ).toBe('parent/007 D.md');
  });

  it('should put the number wherever the template puts it', async () => {
    expect(
      await renumber({
        'parent/A (2).md': 'a',
        'parent/D.md': 'd'
      }, '{{safeName}} ({{index}})')
    ).toBe('parent/D (3).md');
  });

  it('should de-duplicate against a note already holding the numbered name', async () => {
    // The sibling is numbered `2.` and something unrelated already occupies `2. D`, so the rename cannot
    // Simply take it.
    expect(
      await renumber({
        'parent/1. A.md': 'a',
        'parent/2. D.md': 'squatter',
        'parent/D.md': 'd'
      }, '{{index}}. {{safeName}}')
    ).toBe('parent/3. D.md');
  });

  it('should number a note at the vault root', async () => {
    expect(
      await renumber(
        {
          '1. A.md': 'a',
          'D.md': 'd'
        },
        '{{index}}. {{safeName}}',
        'D.md'
      )
    ).toBe('2. D.md');
  });

  it('should resolve the folder tokens against the note\'s own folder', async () => {
    expect(
      await renumber({
        'parent/D.md': 'd'
      }, '{{parentFolder}}-{{index}}-{{safeName}}')
    ).toBe('parent/parent-1-D.md');
  });

  it('should leave the note alone when the template reproduces its current name', async () => {
    // Only reachable through a hand-edited `data.json` — the settings validator requires `{{index}}` — but
    // Without the guard the rename would de-duplicate the note against ITSELF and produce `D 1.md`.
    expect(
      await renumber({
        'parent/D.md': 'd'
      }, '{{safeName}}')
    ).toBe('parent/D.md');
  });

  it('should leave the note alone when the template renders to nothing', async () => {
    // `{{name}}` and `{{path}}` are what this template PRODUCES, so they resolve to nothing here; the
    // Validator rejects them, and a hand-edited setting must not leave the note nameless.
    expect(
      await renumber({
        'parent/D.md': 'd'
      }, '{{name}}')
    ).toBe('parent/D.md');
  });

  it('should scan the vault root for a note reporting no parent at all', async () => {
    // `TFile.parent` is nullable in the API even though a note in a vault always has one, so the fallback
    // Is defensive — but it has to be the ROOT rather than nothing, or there would be no folder to read
    // Siblings from and no prefix to rename into.
    const renameFile = vi.fn(() => noopAsync());
    const app = strictProxy<AppOriginal>({
      fileManager: strictProxy({ renameFile }),
      vault: strictProxy({
        getAvailablePath: (basePath: string, extension: string): string => `${basePath}.${extension}`,
        getRoot: (): TFolder =>
          strictProxy<TFolder>({
            children: [],
            getParentPrefix: (): string => '',
            name: '',
            path: '/'
          })
      })
    });

    await applyNumberedNoteName({
      app,
      file: strictProxy<TFile>({ basename: 'D', extension: 'md', parent: null }),
      pluginSettingsComponent: createPluginSettingsComponent('{{index}}. {{safeName}}')
    });

    expect(renameFile).toHaveBeenCalledWith(expect.anything(), '1. D.md');
  });
});
