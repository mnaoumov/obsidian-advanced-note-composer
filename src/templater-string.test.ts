import type {
  App as AppOriginal,
  TFile
} from 'obsidian';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';
import type { Mock } from 'vitest';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  renderSingleLineValueWithTemplater,
  renderStringWithTemplater,
  renderValueListWithTemplater,
  TemplateRenderError
} from './templater-string.ts';

/**
 * The seam `obsidian-test-mocks` gives a test for putting a plugin in the registry — mock-only, so absent
 * from the `App` type `asOriginalType__()` hands back.
 */
interface PluginsRegistryTestable {
  registerPlugin__: (id: string, plugin: unknown) => void;
}

const SETTING_NAME = 'Folder note aliases template';
const TOKENS = {
  folderName: '1. Alpha',
  folderPath: 'Projects/1. Alpha',
  index: 1,
  parentFolder: 'Projects',
  parentFolderPath: 'Projects',
  rawFolderName: '',
  safeFolderName: 'Alpha'
};

describe('renderStringWithTemplater', () => {
  it('should hand back a template with no Templater command untouched, without Templater installed', async () => {
    const app = createApp();
    expect(await renderStringWithTemplater({ app, contextFile: null, resolvedTemplate: '  Alpha  ', settingName: SETTING_NAME, tokens: TOKENS }))
      .toBe('  Alpha  ');
  });

  it('should name the setting when a non-Error failure comes back from Templater', async () => {
    const app = createApp();
    const parseTemplate = installTemplater(app);
    parseTemplate.mockRejectedValue('boom');

    await expect(renderStringWithTemplater({ app, contextFile: getNote(app), resolvedTemplate: '<% x %>', settingName: SETTING_NAME, tokens: TOKENS }))
      .rejects.toThrow('Folder note aliases template failed: boom');
  });

  it('should name the setting when Templater is not installed', async () => {
    const app = createApp();
    await expect(renderStringWithTemplater({ app, contextFile: getNote(app), resolvedTemplate: '<% x %>', settingName: SETTING_NAME, tokens: TOKENS }))
      .rejects.toThrow('Folder note aliases template uses Templater syntax, but the Templater plugin is not installed');
  });
});

describe('renderSingleLineValueWithTemplater', () => {
  it('should pass the tokens to Templater as the TOKENS prelude and trim what comes back', async () => {
    const app = createApp();
    const parseTemplate = installTemplater(app);
    parseTemplate.mockResolvedValue('  ALPHA\n');

    expect(
      await renderSingleLineValueWithTemplater({
        app,
        contextFile: getNote(app),
        resolvedTemplate: '<% TOKENS.safeFolderName.toUpperCase() %>',
        settingName: SETTING_NAME,
        tokens: TOKENS
      })
    ).toBe('ALPHA');
    expect(parseTemplate.mock.calls[0]?.[1]).toContain('"safeFolderName":"Alpha"');
  });

  it('should refuse a multi-line value, typed so a caller can report it', async () => {
    const app = createApp();
    const parseTemplate = installTemplater(app);
    parseTemplate.mockResolvedValue('Alpha\nBeta');

    const promise = renderSingleLineValueWithTemplater({ app, contextFile: getNote(app), resolvedTemplate: '<% x %>', settingName: SETTING_NAME, tokens: TOKENS });
    await expect(promise).rejects.toBeInstanceOf(TemplateRenderError);
    await expect(promise).rejects.toThrow('Folder note aliases template produced a multi-line value.');
  });
});

describe('renderValueListWithTemplater', () => {
  it('should take one value per line of a template with no Templater command, trimmed and without blanks', async () => {
    const app = createApp();

    expect(
      await renderValueListWithTemplater({
        app,
        contextFile: getNote(app),
        resolvedTemplate: '  Alpha \r\n\nBeta\rAlpha\n',
        settingName: SETTING_NAME,
        tokens: TOKENS
      })
    ).toEqual(['Alpha', 'Beta']);
  });

  it('should take one value per line of what Templater hands back', async () => {
    const app = createApp();
    const parseTemplate = installTemplater(app);
    parseTemplate.mockResolvedValue('A\nB\n');

    expect(
      await renderValueListWithTemplater({
        app,
        contextFile: getNote(app),
        resolvedTemplate: String.raw`<% ["A", "B"].join("\n") %>`,
        settingName: SETTING_NAME,
        tokens: TOKENS
      })
    ).toEqual(['A', 'B']);
  });
});

function createApp(): AppOriginal {
  const app = App.createConfigured__({ files: { 'note.md': 'note' } }).asOriginalType__();
  castTo<GenericObject>(app.workspace)['getRecentFiles'] = vi.fn().mockReturnValue([]);
  return app;
}

function getNote(app: AppOriginal): TFile {
  return ensureNonNullable(app.vault.getFileByPath('note.md'));
}

function installTemplater(app: AppOriginal): Mock {
  const parseTemplate = vi.fn().mockResolvedValue('');
  castTo<PluginsRegistryTestable>(app.plugins).registerPlugin__('templater-obsidian', {
    templater: {
      /* eslint-disable camelcase -- Templater's own API method names. */
      create_running_config: vi.fn().mockReturnValue({}),
      parse_template: parseTemplate
      /* eslint-enable camelcase -- Templater's own API method names. */
    }
  });
  return parseTemplate;
}
