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
  applyNameTransform,
  transformAndFixFileName
} from './name-transform.ts';

interface FixOverrides {
  fileName: string;
  nameTransformTemplate?: string;
  shouldReplaceInvalidCharacters?: boolean;
}

interface TemplaterMock {
  createRunningConfig: Mock;
  parseTemplate: Mock;
}

const MAPPING_TEMPLATE = '<% TOKENS.rawString.replaceAll(": ", " - ") %>';

/**
 * Templater's `RunMode.DynamicProcessor`, restated here so the test pins the number the production code
 * passes rather than importing whatever it happens to pass.
 */
const RUN_MODE_DYNAMIC_PROCESSOR = 4;

describe('applyNameTransform', () => {
  it('should return the name untouched when no template is configured', async () => {
    const app = createApp();
    expect(await applyNameTransform({ app, contextFile: null, rawString: '  a: b  ', template: '' })).toBe('  a: b  ');
  });

  it('should resolve the plugin tokens without involving templater', async () => {
    const app = createApp();
    // No templater plugin is installed, so reaching Templater at all would throw.
    expect(await applyNameTransform({ app, contextFile: null, rawString: 'notes', template: '  Project {{rawString}}  ' }))
      .toBe('Project notes');
  });

  it('should throw on an unknown token', async () => {
    const app = createApp();
    await expect(applyNameTransform({ app, contextFile: null, rawString: 'a', template: '{{nope}}' }))
      .rejects.toThrow('Invalid template key: nope');
  });

  it('should refuse templater syntax when the templater plugin is not installed', async () => {
    const app = createApp();
    await expect(applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE }))
      .rejects.toThrow('Name transform template uses Templater syntax, but the Templater plugin is not installed');
  });

  it('should refuse templater syntax when there is no note to run it against', async () => {
    const app = createApp();
    installTemplater(app);
    vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);

    await expect(applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE }))
      .rejects.toThrow('Name transform template uses Templater syntax, which needs an open note as its context');
  });

  it('should run templater with the TOKENS prelude and trim what comes back', async () => {
    const app = createApp();
    const templater = installTemplater(app);
    templater.parseTemplate.mockResolvedValue('A - B\n');
    const contextFile = getFile(app, 'note.md');

    expect(await applyNameTransform({ app, contextFile, rawString: 'A: B', template: MAPPING_TEMPLATE })).toBe('A - B');

    expect(templater.createRunningConfig).toHaveBeenCalledWith(undefined, contextFile, RUN_MODE_DYNAMIC_PROCESSOR);
    const parsedContent = castTo<string>(templater.parseTemplate.mock.calls[0]?.[1]);
    expect(parsedContent).toContain('const TOKENS = {');
    expect(parsedContent).toContain('"rawString":"A: B"');
    expect(parsedContent.endsWith(MAPPING_TEMPLATE)).toBe(true);
  });

  it('should fall back to the active note when no context file is given', async () => {
    const app = createApp();
    const templater = installTemplater(app);
    templater.parseTemplate.mockResolvedValue('A - B');
    const activeFile = getFile(app, 'note.md');
    vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(activeFile);

    await applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE });

    expect(templater.createRunningConfig).toHaveBeenCalledWith(undefined, activeFile, RUN_MODE_DYNAMIC_PROCESSOR);
  });

  it('should let a failing template through rather than silently leaving the name untransformed', async () => {
    const app = createApp();
    const templater = installTemplater(app);
    templater.parseTemplate.mockRejectedValue(new Error('TOKENS is not defined'));

    await expect(applyNameTransform({ app, contextFile: getFile(app, 'note.md'), rawString: 'A: B', template: MAPPING_TEMPLATE }))
      .rejects.toThrow('TOKENS is not defined');
  });
});

describe('transformAndFixFileName', () => {
  it('should transform before sanitizing, so the mapped character never reaches the replacement', async () => {
    const app = createApp();
    const templater = installTemplater(app);
    templater.parseTemplate.mockResolvedValue('A - B');

    expect(await fix(app, { fileName: 'A: B', nameTransformTemplate: MAPPING_TEMPLATE })).toBe('A - B');
  });

  it('should apply the universal replacement without a template, which is what the transform avoids', async () => {
    const app = createApp();
    expect(await fix(app, { fileName: 'A: B' })).toBe('A_ B');
  });

  it('should leave what the transform did not map for the caller to refuse when replacing is off', async () => {
    const app = createApp();
    const templater = installTemplater(app);
    templater.parseTemplate.mockResolvedValue('A - B?');

    expect(
      await fix(app, {
        fileName: 'A: B?',
        nameTransformTemplate: MAPPING_TEMPLATE,
        shouldReplaceInvalidCharacters: false
      })
    ).toBe('A - B?');
  });
});

function createApp(): AppOriginal {
  const app = App.createConfigured__({ files: { 'note.md': 'note' } }).asOriginalType__();
  // `plugins` is not part of the mock's surface, so it is assigned outright — with no plugin installed by
  // Default, which is the "Templater is missing" case.
  castTo<GenericObject>(app)['plugins'] = { plugins: {} };
  return app;
}

async function fix(app: AppOriginal, overrides: FixOverrides): Promise<string> {
  return await transformAndFixFileName({
    app,
    contextFile: getFile(app, 'note.md'),
    nameTransformTemplate: '',
    replacement: '_',
    shouldReplaceInvalidCharacters: true,
    shouldTreatTitleAsPath: false,
    ...overrides
  });
}

function getFile(app: AppOriginal, path: string): TFile {
  return ensureNonNullable(app.vault.getFileByPath(path));
}

function installTemplater(app: AppOriginal): TemplaterMock {
  const templaterMock: TemplaterMock = {
    createRunningConfig: vi.fn().mockReturnValue({}),
    parseTemplate: vi.fn().mockResolvedValue('')
  };
  castTo<GenericObject>(app)['plugins'] = {
    plugins: {
      'templater-obsidian': {
        templater: {
          /* eslint-disable camelcase -- Templater's own API method names. */
          create_running_config: templaterMock.createRunningConfig,
          parse_template: templaterMock.parseTemplate
          /* eslint-enable camelcase -- Templater's own API method names. */
        }
      }
    }
  };
  return templaterMock;
}
