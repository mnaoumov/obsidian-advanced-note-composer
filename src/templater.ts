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
  overwrite_file_commands(file: TFile, active_file?: boolean): Promise<void>;
}

interface TemplaterPlugin extends Plugin {
  templater: TemplaterApi;
}
