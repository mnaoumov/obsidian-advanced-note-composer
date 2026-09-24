import type { App as AppOriginal } from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { Mock } from 'vitest';

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

import { resolveDestinationTemplaterRunner } from './destination-templater.ts';

interface PluginsRegistryTestable {
  registerPlugin__: (id: string, plugin: unknown) => void;
}

interface TestContext {
  readonly app: AppOriginal;
  readonly showNotice: Mock<PluginNoticeComponent['showNotice']>;
}

describe('resolveDestinationTemplaterRunner', () => {
  it('should return nothing and say nothing when the setting is off', () => {
    const { app, showNotice } = createContext();
    expect(resolveDestinationTemplaterRunner({ app, pluginNoticeComponent: createNotices(showNotice), shouldRunTemplater: false, shouldWarnIfMissing: true }))
      .toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it('should warn once when Templater is missing, and only when asked to', () => {
    const { app, showNotice } = createContext();
    const pluginNoticeComponent = createNotices(showNotice);

    expect(resolveDestinationTemplaterRunner({ app, pluginNoticeComponent, shouldRunTemplater: true, shouldWarnIfMissing: false })).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();

    expect(resolveDestinationTemplaterRunner({ app, pluginNoticeComponent, shouldRunTemplater: true, shouldWarnIfMissing: true })).toBeNull();
    expect(showNotice).toHaveBeenCalledTimes(1);
  });

  it('should run Templater\'s own overwrite over the note, telling it whether the note is active', async () => {
    const { app, showNotice } = createContext();
    const overwriteFileCommands = vi.fn().mockResolvedValue(undefined);
    castTo<PluginsRegistryTestable>(app.plugins).registerPlugin__('templater-obsidian', {
      // eslint-disable-next-line camelcase -- Templater's own API method name.
      templater: { overwrite_file_commands: overwriteFileCommands }
    });
    const note = ensureNonNullable(app.vault.getFileByPath('note.md'));
    const activeFileSpy = vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);

    const runTemplater = ensureNonNullable(
      resolveDestinationTemplaterRunner({ app, pluginNoticeComponent: createNotices(showNotice), shouldRunTemplater: true, shouldWarnIfMissing: true })
    );
    await runTemplater(note);
    activeFileSpy.mockReturnValue(note);
    await runTemplater(note);

    expect(overwriteFileCommands.mock.calls).toEqual([[note, false], [note, true]]);
    expect(showNotice).not.toHaveBeenCalled();
  });
});

function createContext(): TestContext {
  return {
    app: App.createConfigured__({ files: { 'note.md': 'note' } }).asOriginalType__(),
    showNotice: vi.fn<PluginNoticeComponent['showNotice']>()
  };
}

function createNotices(showNotice: Mock<PluginNoticeComponent['showNotice']>): PluginNoticeComponent {
  return strictProxy<PluginNoticeComponent>({ showNotice });
}
