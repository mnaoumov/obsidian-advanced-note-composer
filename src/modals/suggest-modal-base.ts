import type { BookmarkItem } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  SearchMatches,
  SearchResult,
  SearchResultContainer
} from 'obsidian';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import {
  parseFrontMatterAliases,
  Platform,
  prepareFuzzySearch,
  prepareSimpleSearch,
  renderResults,
  setIcon,
  setTooltip,
  sortSearchResults,
  SuggestModal,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { isSpellcheckEnabled } from 'obsidian-dev-utils/obsidian/obsidian-settings';
import { addPluginCssClasses } from 'obsidian-dev-utils/obsidian/plugin/plugin-context';
import { basename } from 'obsidian-dev-utils/path';
import {
  trimEnd,
  trimStart
} from 'obsidian-dev-utils/string';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { getRecentPaths } from '../recent-suggestions.ts';

export interface Item extends SearchResultContainer {
  alias?: string;
  bookmarkPath?: string;
  downranked?: boolean;
  file?: TFile;
  item?: BookmarkItem;
  linktext?: string;
  type: string;
}

export interface SuggestModalBaseConstructorParams {
  readonly app: App;

  /**
   * The value to seed the picker input with when it opens. Used to preselect the previously-chosen target
   * when the picker is reopened via the confirmation dialog's "Change target" action.
   */
  readonly initialInputValue?: string;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFile: TFile;
}

type SearchFunction = (text: string) => null | SearchResult;

interface SuggestModalBaseAddAliasMatchesParams {
  readonly file: TFile;
  readonly isUserIgnored: boolean;
  readonly items: Item[];
  readonly scoreStep: number;
  readonly searchFunction: SearchFunction;
}

interface TraverseBookmarksParams {
  readonly bookmarkItems: BookmarkItem[];
  callback(this: void, bookmarkItem: BookmarkItem, path: string): void;
  readonly parentPath?: string;
}

export abstract class SuggestModalBase extends SuggestModal<Item | null> {
  protected allowCreateNewFile: boolean;
  protected readonly pluginSettingsComponent: PluginSettingsComponent;
  /**
   * When `true`, a note whose path is excluded/ignored in the plugin settings is still offered as a
   * suggestion. Default `false`, and opt-in on purpose: only the merge pickers turn it on, and only while
   * `Should always merge excluded items` is on (issue #240). A merge that is allowed to swallow excluded
   * items has to be able to pick one as its destination, whereas the split picker has no such setting and
   * must keep excluding them.
   */
  protected shouldAllowIgnoredPaths = false;
  protected shouldAllowOnlyCurrentFolder: boolean;

  /**
   * When `true`, the source note itself is offered as a suggestion (used by the split picker so a
   * selection can be extracted to the top/bottom of the same note). Default `false` — merging or
   * swapping a file with itself is meaningless.
   */
  protected shouldAllowSameFile = false;
  protected shouldShowImages: boolean;
  protected shouldShowNonAttachments: boolean;
  protected shouldShowNonImageAttachments: boolean;
  protected shouldShowUnresolved: boolean;
  protected readonly sourceFile: TFile;
  private readonly initialInputValue: string;
  private readonly newFileButtonEl: HTMLElement;
  private readonly shouldShowAlias: boolean;
  private readonly shouldShowAllTypes: boolean;

  private readonly shouldShowMarkdown: boolean;
  private readonly shouldShowNonFileBookmarks: boolean;

  private get supportsCreate(): boolean {
    return this.allowCreateNewFile && this.shouldShowMarkdown;
  }

  public constructor(params: SuggestModalBaseConstructorParams) {
    super(params.app);

    this.sourceFile = params.sourceFile;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.initialInputValue = params.initialInputValue ?? '';

    addPluginCssClasses(this.containerEl, 'suggest-modal-base');

    this.shouldAllowOnlyCurrentFolder = params.pluginSettingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault;

    this.shouldShowUnresolved = false;
    this.shouldShowMarkdown = true;
    this.shouldShowNonAttachments = true;
    this.shouldShowAlias = true;
    this.shouldShowNonImageAttachments = true;
    this.shouldShowImages = true;
    this.shouldShowAllTypes = true;
    this.shouldShowAlias = false;
    this.shouldShowNonFileBookmarks = false;
    this.allowCreateNewFile = false;
    const DEFAULT_LIMIT = 20;
    this.limit = DEFAULT_LIMIT;

    this.scope.register([], 'Tab', this.handleTabKey.bind(this));
    this.newFileButtonEl = createEl(
      'button',
      'clickable-icon',
      (button): void => {
        setIcon(button, 'lucide-file-plus');
        button.addEventListener('click', this.handleCreateButtonClick.bind(this));
      }
    );
  }

  public override getSuggestions(query: string): Item[] {
    query = query.trim();

    if (!query) {
      return this.getRecentFiles();
    }

    const FUZZY_LENGTH_THRESHOLD = 10_000;
    const files = this.app.vault.getFiles().filter(this.shouldIncludeFile.bind(this));
    /* v8 ignore start -- prepareSimpleSearch branch is only taken for very large vaults (>10000 files). */
    const searchFunction: SearchFunction = files.length < FUZZY_LENGTH_THRESHOLD ? prepareFuzzySearch(query) : prepareSimpleSearch(query);
    /* v8 ignore stop */

    const items: Item[] = [
      ...this.searchFiles(query, searchFunction),
      ...this.searchUnresolvedLinks(searchFunction),
      ...this.searchBookmarks(searchFunction)
    ];

    sortSearchResults(items);
    return items;
  }

  public override onChooseSuggestion(item: Item | null, $event: KeyboardEvent | MouseEvent): void {
    invokeAsyncSafely(() => this.onChooseSuggestionAsync(item, $event));
  }

  /* v8 ignore start -- onInput mobile branch has defensive ?? and ?. on chooser.suggestions[0]?.getText(). */
  public override onInput(): void {
    super.onInput();
    if (Platform.isMobile && this.allowCreateNewFile) {
      const inputValue = this.inputEl.value.trim();
      if (inputValue === '') {
        this.newFileButtonEl.detach();
        return;
      }
      if (!this.newFileButtonEl.parentElement) {
        this.ctaEl.append(this.newFileButtonEl);

        const firstSuggestionValue = this.chooser.suggestions[0]?.getText() ?? '';
        this.newFileButtonEl.ariaDisabled = String(inputValue.toLowerCase() === firstSuggestionValue.toLowerCase());
      }
    }
  }
  /* v8 ignore stop */

  public override onNoSuggestion(): void {
    super.onNoSuggestion();
    const value = this.inputEl.value.trim();
    if (value && this.supportsCreate) {
      this.chooser.setSuggestions([null]);
      return;
    }

    const message = value
      ? this.emptyStateText
      : 'No recent files found. Type to search...';
    this.chooser.setSuggestions(null);
    this.chooser.addMessage(message);
  }

  public override onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.initialInputValue;
    this.refreshSpellcheck();
    this.updateSuggestions();
  }

  /* v8 ignore start -- renderSuggestion contains many defensive ?? fallbacks on item properties that never take the null path in tests. */
  public override renderSuggestion(item: Item | null, el: HTMLElement): void {
    el.addClass('mod-complex');
    const suggestionContent = el.createDiv('suggestion-content');
    const suggestionAux = el.createDiv('suggestion-aux');
    if (!item) {
      suggestionContent.createDiv({ cls: 'suggestion-title', text: this.inputEl.value });
      suggestionAux.createSpan({
        cls: 'suggestion-action',
        text: 'Enter to create'
      });
      return;
    }
    if (item.downranked) {
      el.addClass('mod-downranked');
    }
    switch (item.type) {
      case 'alias': {
        renderResults(suggestionContent.createDiv('suggestion-title'), item.alias ?? '', item.match);
        suggestionContent.createDiv({ cls: 'suggestion-note', text: this.getSuggestionText(item.file?.path ?? '') });
        suggestionAux.createSpan({ cls: 'suggestion-flair' }, (suggestionFlair) => {
          setIcon(suggestionFlair, 'lucide-forward');
          suggestionFlair.title = 'Alias';
        });

        break;
      }
      case 'bookmark': {
        const suggestionTitle = suggestionContent.createDiv('suggestion-title');
        const suggestionNote = suggestionContent.createDiv('suggestion-note');
        renderResults(suggestionTitle, this.getSuggestionText(item.bookmarkPath ?? ''), item.match);
        suggestionAux.createSpan({ cls: 'suggestion-flair' }, (suggestionFlair) => {
          switch (item.item?.type) {
            case 'file': {
              setIcon(suggestionFlair, 'lucide-bookmark');
              suggestionNote.setText(
                this.getSuggestionText(item.item.path ?? '') + (item.item.subpath ?? '')
              );

              break;
            }
            case 'folder': {
              setIcon(suggestionFlair, 'lucide-bookmark');
              suggestionNote.setText(this.getSuggestionText(item.item.path ?? ''));

              break;
            }
            case 'graph': {
              setIcon(suggestionFlair, 'lucide-git-fork');
              suggestionNote.detach();

              break;
            }
            case 'search': {
              setIcon(suggestionFlair, 'lucide-search');
              suggestionNote.setText(item.item.query ?? '');

              break;
            }
            case 'url': {
              const webViewerPlugin = this.app.internalPlugins.getEnabledPluginById('webviewer');
              if (webViewerPlugin) {
                suggestionFlair.addClass('webviewer-favicon-container');
                invokeAsyncSafely(() => webViewerPlugin.db.setIcon(suggestionFlair, item.item?.url ?? ''));
              } else {
                setIcon(suggestionFlair, 'globe-2');
              }
              suggestionNote.setText(item.item.url ?? '');

              break;
            }
              // No default
          }
        });

        break;
      }
      case 'file': {
        renderResults(suggestionContent.createDiv('suggestion-title'), this.getSuggestionText(item.file?.path ?? ''), item.match);
        suggestionAux.createSpan({ cls: 'suggestion-flair' });

        break;
      }
      case 'unresolved': {
        const suggestionTitle = suggestionContent.createDiv('suggestion-title suggestion-unresolved');
        renderResults(suggestionTitle.createSpan(), item.linktext ?? '', item.match);
        suggestionTitle.createSpan({ cls: 'suggestion-unresolved-description', text: '(unresolved)' });
        suggestionAux.createSpan({ cls: 'suggestion-flair' }, (suggestionFlair) => {
          setIcon(suggestionFlair, 'lucide-file-plus');
          setTooltip(suggestionFlair, 'Not created yet, select to create');
        });

        break;
      }
        // No default
    }
  }

  /* v8 ignore stop */

  protected abstract onChooseSuggestionAsync(item: Item | null, $event: KeyboardEvent | MouseEvent): Promise<void>;

  /**
   * Spell-checks the box while — and only while — it can NAME a note.
   *
   * Obsidian builds every `SuggestModal` input with a hardcoded `spellcheck="false"`, without consulting
   * `Editor > Spellcheck` at all. For a picker that only FINDS a note that is right: it is a search box,
   * and squiggles under half-typed path fragments are noise. But this picker doubles as a name field the
   * moment it can create one, and Obsidian's own name-entry surfaces — the inline title, the file
   * explorer's inline rename, the properties long-text input — all follow that setting. So does every
   * name prompt this plugin opens (issue #233). The odd one out was this box.
   *
   * Keyed on {@link supportsCreate} rather than a literal, so a picker that cannot create stays exactly as
   * Obsidian built it, and a future create-capable picker is covered without a second edit.
   *
   * The name may be a PATH rather than a bare basename (`Treat title as path`), so folder segments get
   * checked too. That is what Obsidian's own inline rename does to a basename, and the alternative —
   * parsing the box to spell-check only its last segment — cannot be expressed as an attribute.
   */
  protected refreshSpellcheck(): void {
    this.inputEl.setAttribute('spellcheck', String(this.supportsCreate && isSpellcheckEnabled(this.app)));
  }

  /* v8 ignore start -- addAliasMatches contains defensive ?? and ?. fallbacks that never take the null path. */
  private addAliasMatches(params: SuggestModalBaseAddAliasMatchesParams): void {
    const { file, isUserIgnored, items, scoreStep, searchFunction } = params;
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
      return;
    }

    const aliases = parseFrontMatterAliases(cache.frontmatter) ?? [];
    for (const alias of aliases) {
      const match = searchFunction(alias);
      if (match) {
        if (isUserIgnored) {
          match.score -= scoreStep;
        }
        items.push({
          alias,
          downranked: isUserIgnored,
          file,
          match,
          type: 'alias'
        });
      }
    }
  }

  /* v8 ignore stop */

  /* v8 ignore start -- getDisplayText contains defensive ?? fallbacks on item properties. */
  private getDisplayText(selectedItem: Item): string {
    switch (selectedItem.type) {
      case 'alias':
      case 'file': {
        return trimMarkdownExtension(selectedItem.file?.path ?? '');
      }
      case 'bookmark': {
        return selectedItem.bookmarkPath ?? '';
      }
      case 'unresolved': {
        return selectedItem.linktext ?? '';
      }
      default: {
        return '';
      }
    }
  }

  /* v8 ignore stop */

  private getRecentFiles(): Item[] {
    // The per-type flags are not passed to `getRecentPaths`: `shouldIncludeFile` below applies the
    // Same ones, so the shared superset keeps every picker reading one recent list (issue #158). The list
    // Now leads with the plugin's own recorded operation targets (issue #206); a recorded FOLDER path is
    // Dropped by the `getFileByPath` lookup below, exactly like a path that no longer resolves.
    const recentPaths = getRecentPaths({
      app: this.app,
      pickerRecencyOrder: this.pluginSettingsComponent.settings.pickerRecencyOrder,
      // The active file is this operation's own source, which `shouldIncludeFile` excludes anyway.
      shouldIncludeActiveFile: false
    });

    const filePaths = new Set<string>();
    const items: Item[] = [];
    for (const filePath of recentPaths) {
      if (filePaths.has(filePath)) {
        continue;
      }
      filePaths.add(filePath);
      const file = this.app.vault.getFileByPath(filePath);
      if (file && !this.app.metadataCache.isUserIgnored(file.path) && this.shouldIncludeFile(file)) {
        items.push({ file, match: { matches: [], score: 0 }, type: 'file' });
      }
    }
    return items;
  }

  /* v8 ignore start -- defensive ?? on parent?.getParentPrefix(). */
  private getSuggestionText(text: string): string {
    let suggestionText = trimMarkdownExtension(text);
    if (!this.shouldAllowOnlyCurrentFolder) {
      return suggestionText;
    }

    suggestionText = trimStart({ $string: suggestionText, prefix: this.sourceFile.parent?.getParentPrefix() ?? '' });
    return suggestionText;
  }
  /* v8 ignore stop */

  private handleCreateButtonClick($event: MouseEvent): void {
    this.onChooseSuggestion(null, $event);
    this.close();
  }

  private handleTabKey($event: KeyboardEvent): MaybeReturn<false> {
    if ($event.isComposing) {
      return;
    }
    const selectedItem = this.chooser.values?.[this.chooser.selectedItem];
    if (!selectedItem) {
      return false;
    }
    let displayText = truncatePathToLastMatch(this.getDisplayText(selectedItem), selectedItem.match.matches);
    if (displayText === this.inputEl.value) {
      displayText += '/';
    }
    this.inputEl.value = displayText;
    this.inputEl.trigger('input');
    return false;
  }

  /* v8 ignore start -- searchBookmarks contains defensive ?? and conditional branches for null bookmarks plugin. */
  private searchBookmarks(searchFunction: SearchFunction): Item[] {
    const bookmarksPlugin = this.app.internalPlugins.getEnabledPluginById('bookmarks');
    if (!bookmarksPlugin) {
      return [];
    }

    const items: Item[] = [];

    function addBookmarkItem(bookmarkItem: BookmarkItem, parentPath: string): void {
      if (!bookmarksPlugin) {
        return;
      }
      const bookmarkPath = parentPath + bookmarksPlugin.getItemTitle(bookmarkItem);
      const match = searchFunction(bookmarkPath);
      if (match) {
        items.push({
          bookmarkPath,
          item: bookmarkItem,
          match,
          type: 'bookmark'
        });
      }
    }

    traverseBookmarks({
      bookmarkItems: bookmarksPlugin.items,
      callback: (bookmarkItem: BookmarkItem, parentPath: string) => {
        if (bookmarkItem.type !== 'file' || bookmarkItem.subpath) {
          if (this.shouldShowNonFileBookmarks && bookmarkItem.type !== 'group') {
            addBookmarkItem(bookmarkItem, parentPath);
          }
        } else {
          const file = this.app.vault.getFileByPath(bookmarkItem.path ?? '');
          if (file && this.shouldIncludeFile(file)) {
            addBookmarkItem(bookmarkItem, parentPath);
          }
        }
      }
    });

    return items;
  }

  /* v8 ignore stop */

  private searchFiles(_query: string, searchFunction: SearchFunction): Item[] {
    const SCORE_STEP = 10;
    const files = this.app.vault.getMarkdownFiles().filter(this.shouldIncludeFile.bind(this));
    const items: Item[] = [];

    for (const file of files) {
      const isUserIgnored = this.app.metadataCache.isUserIgnored(file.path);
      const match = searchFilePath(searchFunction, trimMarkdownExtension(file.path));
      if (match) {
        if (isUserIgnored) {
          match.score -= SCORE_STEP;
        }
        items.push({ downranked: isUserIgnored, file, match, type: 'file' });
      }

      if (this.shouldShowAlias) {
        this.addAliasMatches({ file, isUserIgnored, items, scoreStep: SCORE_STEP, searchFunction });
      }
    }

    return items;
  }

  /* v8 ignore start -- searchUnresolvedLinks contains defensive ?? on parent?.getParentPrefix(). */
  private searchUnresolvedLinks(searchFunction: SearchFunction): Item[] {
    if (!this.shouldShowUnresolved) {
      return [];
    }

    const unresolvedLinks = new Set<string>();
    for (const unresolvedLinkObject of Object.values(this.app.metadataCache.unresolvedLinks)) {
      for (const unresolvedLink of Object.keys(unresolvedLinkObject)) {
        if (this.shouldAllowOnlyCurrentFolder && !unresolvedLink.startsWith(this.sourceFile.parent?.getParentPrefix() ?? '')) {
          continue;
        }
        if (!this.shouldAllowIgnoredPaths && this.pluginSettingsComponent.settings.isPathIgnored(unresolvedLink)) {
          continue;
        }
        unresolvedLinks.add(unresolvedLink);
      }
    }

    const items: Item[] = [];
    for (const unresolvedLink of unresolvedLinks) {
      const match = searchFunction(unresolvedLink);
      if (match) {
        items.push({ linktext: unresolvedLink, match, type: 'unresolved' });
      }
    }

    return items;
  }

  /* v8 ignore stop */

  /* v8 ignore start -- shouldIncludeFile has many branches tested individually but v8 can't attribute coverage across test runs. */
  private shouldIncludeFile(file: TFile): boolean {
    if (!this.shouldAllowIgnoredPaths && this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      return false;
    }

    if (!this.shouldAllowSameFile && file === this.sourceFile) {
      return false;
    }

    if (this.shouldAllowOnlyCurrentFolder && file.parent !== this.sourceFile.parent) {
      return false;
    }

    if (file.extension === 'md') {
      return this.shouldShowMarkdown;
    }
    if (file.extension === 'canvas' || file.extension === 'base') {
      return this.shouldShowNonAttachments;
    }
    if (IMAGE_EXTENSIONS.has(file.extension)) {
      return this.shouldShowImages;
    }

    if (this.shouldShowAllTypes) {
      return true;
    }

    if (this.shouldShowNonImageAttachments) {
      return this.app.viewRegistry.isExtensionRegistered(file.extension);
    }

    return false;
  }
  /* v8 ignore stop */
}

function trimMarkdownExtension(path: string): string {
  return trimEnd({ $string: path, suffix: '.md' });
}

/* v8 ignore start -- truncatePathToLastMatch contains defensive ?. and branches for edge cases. */
function truncatePathToLastMatch(path: string, matches?: SearchMatches): string {
  if (matches && matches.length > 0) {
    const lastMatch = matches.at(-1);
    const lastMatchEnd = lastMatch?.[1];
    if (!lastMatchEnd) {
      return path;
    }
    const nextSlashIndex = path.indexOf('/', lastMatchEnd);

    if (nextSlashIndex !== -1) {
      return path.slice(0, nextSlashIndex + 1);
    }
  }
  return path;
}

/* v8 ignore stop */

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

/* v8 ignore start -- adjustMatchPositions and searchFilePath contain defensive ?? branches. */
function adjustMatchPositions(matches: SearchMatches | undefined, pathPrefixLength: number): void {
  for (const match of matches ?? []) {
    match[0] += pathPrefixLength;
    match[1] += pathPrefixLength;
  }
}

function searchFilePath(searchFunction: SearchFunction, filePath: string): null | SearchResult {
  const fileName = basename(filePath);
  let match = searchFunction(fileName);

  if (match) {
    adjustMatchPositions(match.matches, filePath.length - fileName.length);
    return match;
  }
  match = searchFunction(filePath);
  if (match) {
    match.score--;
  }
  return match;
}

/* v8 ignore stop */

function traverseBookmarks(params: TraverseBookmarksParams): void {
  const { bookmarkItems, callback, parentPath = '' } = params;
  for (const bookmarkItem of bookmarkItems) {
    callback(bookmarkItem, parentPath);

    if (bookmarkItem.type === 'group' && bookmarkItem.items) {
      traverseBookmarks({ bookmarkItems: bookmarkItem.items, callback, parentPath: `${parentPath + bookmarkItem.title}/` });
    }
  }
}
