import type { TFile } from 'obsidian';

import { TemplaterRunMode } from '@mnaoumov/obsidian-lib/templater';
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
import {
  getTemplaterPluginApi,
  TEMPLATER_PLUGIN_API_ADAPTER
} from './templater.ts';

describe('getTemplaterPluginApi', () => {
  it('should answer null while Templater is not loaded', () => {
    const app = App.createConfigured__().asOriginalType__();

    expect(getTemplaterPluginApi(app)).toBeNull();
  });

  it('should hand over the templater object and the editor handler of a complete instance', () => {
    const app = App.createConfigured__().asOriginalType__();
    const stub = createTemplaterPluginStub();
    registerPluginStub(app, 'templater-obsidian', stub);

    const api = getTemplaterPluginApi(app);

    expect(api?.templater).toBe(stub.templater);
    expect(api?.editorHandler).toBe(stub.editor_handler);
  });

  it('should read an instance missing a member this plugin calls as not available', () => {
    const stub = createTemplaterPluginStub();
    // eslint-disable-next-line camelcase -- `Templater`'s own API method name.
    const withoutParseTemplate = { ...stub, templater: { ...stub.templater, parse_template: undefined } };

    expect(TEMPLATER_PLUGIN_API_ADAPTER.getApi(castTo(withoutParseTemplate))).toBeNull();
  });

  it('should read an instance the library adapter does not recognize as not available', () => {
    expect(TEMPLATER_PLUGIN_API_ADAPTER.getApi(castTo({}))).toBeNull();
  });

  it('should read an instance with no editor handler as not available', () => {
    const { templater } = createTemplaterPluginStub();

    expect(TEMPLATER_PLUGIN_API_ADAPTER.getApi(castTo({ templater }))).toBeNull();
  });

  it('should read an editor handler without the cursor jump as not available', () => {
    const { templater } = createTemplaterPluginStub();

    // eslint-disable-next-line camelcase -- `Templater`'s own API property name.
    expect(TEMPLATER_PLUGIN_API_ADAPTER.getApi(castTo({ editor_handler: {}, templater }))).toBeNull();
  });
});

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
});
