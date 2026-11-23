import type { TFile } from 'obsidian';

import {
  resolveTemplaterPluginApi,
  TEMPLATER_PLUGIN_API_ADAPTER,
  TemplaterRunMode
} from '@mnaoumov/obsidian-lib/templater';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  createTemplaterPluginStub,
  registerPluginStub
} from './templater-stub.ts';

describe('createTemplaterPluginStub', () => {
  it('should give every member a harmless default', async () => {
    const { editor_handler: editorHandler, templater } = createTemplaterPluginStub();
    const file = castTo<TFile>({ path: 'note.md' });
    const config = templater.create_running_config(undefined, file, TemplaterRunMode.OverwriteFile);

    expect(config.target_file).toBe(file);
    await expect(templater.parse_template(config, 'text')).resolves.toBe('text');
    await expect(templater.read_and_parse_template(config)).resolves.toBe('');
    await expect(templater.functions_generator.generate_object(config)).resolves.toEqual({});
    await expect(templater.overwrite_file_commands(file)).resolves.toBeUndefined();
    await expect(templater.end_templater_task('note.md')).resolves.toBeUndefined();
    templater.start_templater_task('note.md');
    await expect(editorHandler.jump_to_next_cursor_location(file, true)).resolves.toBeUndefined();
  });

  it('should carry every member the library adapter verifies', () => {
    const stub = createTemplaterPluginStub();

    expect(TEMPLATER_PLUGIN_API_ADAPTER.getApi(castTo(stub))).not.toBeNull();
  });
});

describe('registerPluginStub', () => {
  it('should make a registered stub read as available', () => {
    const app = App.createConfigured__().asOriginalType__();
    const stub = createTemplaterPluginStub();

    expect(resolveTemplaterPluginApi(app)).toBeNull();

    registerPluginStub(app, 'templater-obsidian', stub);
    const api = resolveTemplaterPluginApi(app);

    expect(api?.templater).toBe(stub.templater);
    expect(api?.editorHandler).toBe(stub.editor_handler);
  });
});
