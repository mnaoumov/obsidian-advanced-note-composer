import type {
  Plugin,
  TFile
} from 'obsidian';

declare module '@obsidian-typings/obsidian-public-latest' {
  interface PluginsPluginsRecord {
    ['templater-obsidian']?: TemplaterPlugin;
  }
}

interface TemplaterApi {
  // eslint-disable-next-line unicorn/consistent-boolean-name -- `active_file` is Templater's own API parameter name.
  overwrite_file_commands(file: TFile, active_file?: boolean): Promise<void>;
}

interface TemplaterPlugin extends Plugin {
  templater: TemplaterApi;
}
