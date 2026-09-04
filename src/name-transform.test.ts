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
  NameTransformError,
  transformAndFixFileName
} from './name-transform.ts';

interface CreateAppOverrides {
  files: Record<string, string>;
}

interface FixOverrides {
  fileName: string;
  nameTransformTemplate?: string;
  shouldReplaceInvalidCharacters?: boolean;
}

/**
 * The seam `obsidian-test-mocks` gives a test for putting a plugin in the registry.
 *
 * `registerPlugin__` is mock-only, so it is absent from the `App` type `asOriginalType__()` hands back even
 * though it is right there at runtime. The registry itself is modelled now, which is why nothing here has to
 * assign over `app.plugins` any more.
 */
interface PluginsRegistryTestable {
  registerPlugin__(id: string, plugin: unknown): void;
}

interface TemplaterMock {
  createRunningConfig: Mock;
  parseTemplate: Mock;
}

/**
 * A modification time later than the one the mock stamps on a file it creates, for the tests that pin
 * which note the newest-note fallback picks.
 *
 * Far-future rather than merely non-zero: `obsidian-test-mocks` stamps a real wall-clock time, so a small
 * absolute constant is in the past and the fallback picks the untouched note instead. It used to default
 * to `0`, which is why `1000` read as "later" until then.
 */
const LATER_MTIME = 4_000_000_000_000;

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

  it('should refuse templater syntax only when the vault holds no note at all (issue #218)', async () => {
    const app = createApp({ files: {} });
    installTemplater(app);
    installRecentFiles(app, []);
    vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);

    await expect(applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE }))
      .rejects.toThrow('Name transform template uses Templater syntax, which needs a note as its context, and this vault has none');
  });

  it('should fall back to the most recently opened note when nothing is open (issue #218)', async () => {
    // A folder command has no note of its own to offer, so before #218 a configured template refused it
    // Outright whenever the user had nothing focused.
    const app = createApp({ files: { 'newest.md': 'newest', 'recent.md': 'recent' } });
    const templater = installTemplater(app);
    templater.parseTemplate.mockResolvedValue('A - B');
    touch(app, 'newest.md', LATER_MTIME);
    installRecentFiles(app, ['recent.md']);
    vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);

    await applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE });

    // The recently-opened note wins over the newer one: it is the note the user was actually looking at.
    expect(templater.createRunningConfig).toHaveBeenCalledWith(undefined, getFile(app, 'recent.md'), RUN_MODE_DYNAMIC_PROCESSOR);
  });

  it('should skip a recent path that no longer resolves, and anything that is not a note', async () => {
    const app = createApp({ files: { 'attachment.pdf': 'pdf', 'still-here.md': 'still here' } });
    const templater = installTemplater(app);
    templater.parseTemplate.mockResolvedValue('A - B');
    installRecentFiles(app, ['deleted.md', 'attachment.pdf', 'still-here.md']);
    vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);

    await applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE });

    expect(templater.createRunningConfig).toHaveBeenCalledWith(undefined, getFile(app, 'still-here.md'), RUN_MODE_DYNAMIC_PROCESSOR);
  });

  it('should fall back to the newest note when the recent list offers nothing', async () => {
    // The vault where no note was ever OPENED — a fresh install — still has notes to report on.
    const app = createApp({ files: { 'newest.md': 'newest', 'older.md': 'older' } });
    const templater = installTemplater(app);
    templater.parseTemplate.mockResolvedValue('A - B');
    touch(app, 'newest.md', LATER_MTIME);
    installRecentFiles(app, []);
    vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);

    await applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE });

    expect(templater.createRunningConfig).toHaveBeenCalledWith(undefined, getFile(app, 'newest.md'), RUN_MODE_DYNAMIC_PROCESSOR);
  });

  it('should break a modification-time tie on the path, so the same vault always picks the same note', async () => {
    // `Create folder with notes...` writes its notes in the same millisecond by the handful. The vault is
    // Seeded in REVERSE path order, so picking `a.md` can only be the tie-break and not the walk order.
    // eslint-disable-next-line perfectionist/sort-objects -- The unsorted order IS the fixture: the mock vault walks its files in insertion order.
    const app = createApp({ files: { 'b.md': 'b', 'a.md': 'a' } });
    const templater = installTemplater(app);
    templater.parseTemplate.mockResolvedValue('A - B');
    touch(app, 'a.md', LATER_MTIME);
    touch(app, 'b.md', LATER_MTIME);
    installRecentFiles(app, []);
    vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);

    await applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE });

    expect(templater.createRunningConfig).toHaveBeenCalledWith(undefined, getFile(app, 'a.md'), RUN_MODE_DYNAMIC_PROCESSOR);
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

  it('should refuse a multi-line result, which is a name no file system can hold (issue #203)', async () => {
    // Issue #203's reporter wrote one Templater command per line; this is the same shape through the
    // Plugin's own token pass, which is why the token path has to refuse it too.
    const app = createApp();
    await expect(applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: '{{rawString}}\n{{rawString}}' }))
      .rejects.toThrow('Name transform template produced a multi-line name: \'A: B\' / \'A: B\'.');
  });

  it('should refuse a multi-line result coming back from templater', async () => {
    const app = createApp();
    const templater = installTemplater(app);
    // The two lines the reporter's own template produced, blank line included — a blank line is neither a
    // Name nor part of one, so it is left out of the message.
    templater.parseTemplate.mockResolvedValue('A - B\n\nA: B');

    await expect(applyNameTransform({ app, contextFile: getFile(app, 'note.md'), rawString: 'A: B', template: MAPPING_TEMPLATE }))
      .rejects.toThrow('Name transform template produced a multi-line name: \'A - B\' / \'A: B\'.');
  });

  it('should type every refusal so a caller can tell a broken template from a real bug', async () => {
    const app = createApp();
    await expect(applyNameTransform({ app, contextFile: null, rawString: 'a', template: '{{nope}}' }))
      .rejects.toBeInstanceOf(NameTransformError);
    await expect(applyNameTransform({ app, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE }))
      .rejects.toBeInstanceOf(NameTransformError);

    const emptyVaultApp = createApp({ files: {} });
    installTemplater(emptyVaultApp);
    vi.spyOn(emptyVaultApp.workspace, 'getActiveFile').mockReturnValue(null);
    await expect(applyNameTransform({ app: emptyVaultApp, contextFile: null, rawString: 'A: B', template: MAPPING_TEMPLATE }))
      .rejects.toBeInstanceOf(NameTransformError);
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

function createApp(overrides?: CreateAppOverrides): AppOriginal {
  const app = App.createConfigured__({ files: overrides?.files ?? { 'note.md': 'note' } }).asOriginalType__();
  // `getRecentFiles` is not part of the mock's surface, and the Templater-context fallback chain consults it
  // Whenever no note is open (issue #218) — stubbed empty for every test, so only the tests that care about
  // It say so. No plugin is registered here, which is the "Templater is missing" case.
  installRecentFiles(app, []);
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

function installRecentFiles(app: AppOriginal, paths: readonly string[]): void {
  castTo<GenericObject>(app.workspace)['getRecentFiles'] = vi.fn().mockReturnValue([...paths]);
}

function installTemplater(app: AppOriginal): TemplaterMock {
  const templaterMock: TemplaterMock = {
    createRunningConfig: vi.fn().mockReturnValue({}),
    parseTemplate: vi.fn().mockResolvedValue('')
  };
  castTo<PluginsRegistryTestable>(app.plugins).registerPlugin__('templater-obsidian', {
    templater: {
      /* eslint-disable camelcase -- Templater's own API method names. */
      create_running_config: templaterMock.createRunningConfig,
      parse_template: templaterMock.parseTemplate
      /* eslint-enable camelcase -- Templater's own API method names. */
    }
  });
  return templaterMock;
}

function touch(app: AppOriginal, path: string, mtime: number): void {
  getFile(app, path).stat.mtime = mtime;
}
