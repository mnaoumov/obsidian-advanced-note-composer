import type { GenericObject } from '@mnaoumov/typescript-lib/type-guards';
import type { App } from 'obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';

import type {
  TemplaterApi,
  TemplaterEditorHandler
} from './templater.ts';

/**
 * Options for {@link createTemplaterPluginStub}.
 */
export interface CreateTemplaterPluginStubOptions {
  /**
   * Members of the plugin's `editor_handler` to replace.
   */
  readonly editorHandler?: Partial<TemplaterEditorHandler>;

  /**
   * Members of the plugin's `templater` object to replace.
   */
  readonly templater?: Partial<TemplaterApi>;
}

/**
 * A stand-in for a running `Templater` instance, carrying every member `TEMPLATER_PLUGIN_API_ADAPTER` verifies.
 */
export interface TemplaterPluginStub {
  readonly editor_handler: TemplaterEditorHandler;
  readonly templater: TemplaterApi;
}

interface PluginsRegistryTestable {
  readonly registerPlugin__: (id: string, plugin: unknown) => void;
}

/**
 * Creates a stand-in for a running `Templater` instance for unit tests, with every member the adapter verifies
 * present (each a no-op unless replaced), so a test registers it under `templater-obsidian` and only spells out
 * the members it observes.
 *
 * @param options - The {@link CreateTemplaterPluginStubOptions}.
 * @returns The stub.
 */
export function createTemplaterPluginStub(options: CreateTemplaterPluginStubOptions = {}): TemplaterPluginStub {
  /* eslint-disable camelcase -- `Templater`'s own API member names. */
  return {
    editor_handler: {
      jump_to_next_cursor_location: async (): Promise<void> => {
        await noopAsync();
      },
      ...options.editorHandler
    },
    templater: {
      create_running_config: (templateFile, targetFile, runMode) => ({ run_mode: runMode, target_file: targetFile, template_file: templateFile }),
      end_templater_task: async (): Promise<void> => {
        await noopAsync();
      },
      functions_generator: {
        generate_object: async (): Promise<object> => {
          await noopAsync();
          return {};
        }
      },
      overwrite_file_commands: async (): Promise<void> => {
        await noopAsync();
      },
      parse_template: async (_config, templateContent): Promise<string> => {
        await noopAsync();
        return templateContent;
      },
      read_and_parse_template: async (): Promise<string> => {
        await noopAsync();
        return '';
      },
      start_templater_task: (): void => {
        // Nothing to register in a stub.
      },
      ...options.templater
    }
  };
  /* eslint-enable camelcase -- `Templater`'s own API member names. */
}

/**
 * Registers a stand-in plugin instance with a test app so `@mnaoumov/obsidian-lib`'s availability check reads it
 * as available.
 *
 * `obsidian-test-mocks` 7.2.3 does not model `Plugins.loadingPluginId`, which that check reads, and its strict
 * proxy throws on an unmodeled read, so this assigns it `null` (no plugin loading) alongside the registration.
 *
 * @param app - The test app.
 * @param pluginId - The plugin id to register under.
 * @param plugin - The stand-in instance.
 */
export function registerPluginStub(app: App, pluginId: string, plugin: unknown): void {
  castTo<PluginsRegistryTestable>(app.plugins).registerPlugin__(pluginId, plugin);
  castTo<GenericObject>(app.plugins)['loadingPluginId'] = null;
}
