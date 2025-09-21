import type {
  Instruction,
  Modifier,
  SearchMatches,
  SearchResult,
  SearchResultContainer
} from 'obsidian';
import type { MaybeReturn } from 'obsidian-dev-utils/Type';
import type { BookmarkItem } from 'obsidian-typings';

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
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { noop } from 'obsidian-dev-utils/Function';
import { addPluginCssClasses } from 'obsidian-dev-utils/obsidian/Plugin/PluginContext';
import { basename } from 'obsidian-dev-utils/Path';
import {
  trimEnd,
  trimStart
} from 'obsidian-dev-utils/String';

import type { AdvancedNoteComposer } from './AdvancedNoteComposer.ts';

export interface Item extends SearchResultContainer {
  alias?: string;
  bookmarkPath?: string;
  downranked?: boolean;
  file?: TFile;
  item?: BookmarkItem;
  linktext?: string;
  type: string;
}

interface AnimationState {
  complete: (() => void) | undefined;
  fn: () => void;
  props: Animation;
  timer: number;
  win: Window;
}

interface RegisterCommandWithCheckboxOptions {
  initCheckbox(this: void, checkboxEl: HTMLInputElement): void;
  key: string;
  modifiers?: Modifier[];
  purpose: string;
}

type SearchFn = (text: string) => null | SearchResult;

class Animation {
  public readonly duration: number;
  public readonly end: Record<string, string> = {};
  public readonly fn: string;
  public readonly from: Record<string, string> = {};
  public readonly to: Record<string, string> = {};

  public constructor(config?: { duration?: number; fn?: string }) {
    const options = config ?? {};
    const DEFAULT_DURATION = 100;
    const DEFAULT_FN = 'ease-in-out';
    this.duration = options.duration ?? DEFAULT_DURATION;
    this.fn = options.fn ?? DEFAULT_FN;
  }

  /**
   * Adds a CSS property to animate
   * @param property - The CSS property name
   * @param fromValue - The starting value (optional)
   * @param toValue - The ending value (optional)
   * @param endValue - The final value after animation (optional)
   * @returns This animation instance for chaining
   */
  public addProp(property: string, fromValue?: null | string, toValue?: null | string, endValue?: null | string): this {
    if (typeof fromValue === 'string') {
      this.from[property] = fromValue;
    }
    if (typeof toValue === 'string') {
      this.to[property] = toValue;
    }
    if (typeof endValue === 'string') {
      this.end[property] = endValue;
    }
    return this;
  }
}

export abstract class SuggestModalBase extends SuggestModal<Item | null> {
  protected allowCreateNewFile: boolean;
  protected shouldShowAlias: boolean;
  protected shouldShowImages: boolean;
  protected shouldShowMarkdown: boolean;
  protected shouldShowNonAttachments: boolean;
  protected shouldShowNonFileBookmarks: boolean;
  protected shouldShowNonImageAttachments: boolean;
  protected shouldShowUnresolved: boolean;
  private readonly context: string;
  private readonly createButtonEl: HTMLElement;
  private readonly shouldShowAllTypes: boolean;

  private get supportsCreate(): boolean {
    return this.allowCreateNewFile && this.shouldShowMarkdown;
  }

  public constructor(protected readonly composer: AdvancedNoteComposer) {
    super(composer.app);

    addPluginCssClasses(this.containerEl, 'suggest-modal-base');

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
    this.context = 'view';
    const DEFAULT_LIMIT = 20;
    this.limit = DEFAULT_LIMIT;

    this.scope.register([], 'Tab', this.handleTabKey.bind(this));
    this.createButtonEl = createEl(
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
    const searchFn: SearchFn = files.length < FUZZY_LENGTH_THRESHOLD ? prepareFuzzySearch(query) : prepareSimpleSearch(query);

    const items: Item[] = [];
    items.push(...this.searchFiles(query, searchFn));
    items.push(...this.searchUnresolvedLinks(searchFn));
    items.push(...this.searchBookmarks(searchFn));

    sortSearchResults(items);
    return items;
  }

  public override onChooseSuggestion(item: Item | null, evt: KeyboardEvent | MouseEvent): void {
    invokeAsyncSafely(() => this.onChooseSuggestionAsync(item, evt));
  }

  public override onInput(): void {
    super.onInput();
    if (Platform.isMobile && this.allowCreateNewFile) {
      const inputValue = this.inputEl.value.trim();
      if (inputValue === '') {
        this.createButtonEl.detach();
        return;
      }
      if (!this.createButtonEl.parentElement) {
        this.ctaEl.appendChild(this.createButtonEl);
        const ANIMATION_DURATION = 150;
        const ANIMATION_FN = 'cubic-bezier(0, 0.55, 0.45, 1)';

        animateElement(
          this.createButtonEl,
          new Animation({
            duration: ANIMATION_DURATION,
            fn: ANIMATION_FN
          }).addProp('transform', 'scale(0.10)', '')
        );
        const firstSuggestionValue = this.chooser.suggestions[0]?.getText() ?? '';
        this.createButtonEl.ariaDisabled = String(inputValue.toLowerCase() === firstSuggestionValue.toLowerCase());
      }
    }
  }

  public override onNoSuggestion(): void {
    const value = this.inputEl.value.trim();
    if (value && this.supportsCreate) {
      this.chooser.setSuggestions([null]);
      return;
    }

    const message = value
      ? this.emptyStateText
      : window.i18next.t('plugins.search.label-no-recent-files-found');
    this.chooser.setSuggestions(null);
    this.chooser.addMessage(message);
  }

  public override renderSuggestion(item: Item | null, el: HTMLElement): void {
    el.addClass('mod-complex');
    const suggestionContent = el.createDiv('suggestion-content');
    const suggestionAux = el.createDiv('suggestion-aux');
    if (!item) {
      suggestionContent.createDiv({ cls: 'suggestion-title', text: this.inputEl.value });
      suggestionAux.createSpan({
        cls: 'suggestion-action',
        text: window.i18next.t('interface.label-enter-to-create')
      });
      return;
    }
    if (item.downranked) {
      el.addClass('mod-downranked');
    }
    if (item.type === 'file') {
      renderResults(suggestionContent.createDiv('suggestion-title'), this.getSuggestionText(item.file?.path ?? ''), item.match);
      suggestionAux.createSpan({ cls: 'suggestion-flair' });
    } else if (item.type === 'alias') {
      renderResults(suggestionContent.createDiv('suggestion-title'), item.alias ?? '', item.match);
      suggestionContent.createDiv({ cls: 'suggestion-note', text: this.getSuggestionText(item.file?.path ?? '') });
      suggestionAux.createSpan({ cls: 'suggestion-flair' }, (suggestionFlair) => {
        setIcon(suggestionFlair, 'lucide-forward');
        suggestionFlair.title = window.i18next.t('interface.tooltip.alias');
      });
    } else if (item.type === 'unresolved') {
      const suggestionTitle = suggestionContent.createDiv('suggestion-title suggestion-unresolved');
      renderResults(suggestionTitle.createSpan(), item.linktext ?? '', item.match);
      suggestionTitle.createSpan({ cls: 'suggestion-unresolved-description', text: '(unresolved)' });
      suggestionAux.createSpan({ cls: 'suggestion-flair' }, (suggestionFlair) => {
        setIcon(suggestionFlair, 'lucide-file-plus');
        setTooltip(suggestionFlair, window.i18next.t('interface.tooltip.not-created-yet'));
      });
    } else if (item.type === 'bookmark') {
      const suggestionTitle = suggestionContent.createDiv('suggestion-title');
      const suggestionNote = suggestionContent.createDiv('suggestion-note');
      renderResults(suggestionTitle, this.getSuggestionText(item.bookmarkPath ?? ''), item.match);
      suggestionAux.createSpan({ cls: 'suggestion-flair' }, (suggestionFlair) => {
        if (item.item?.type === 'file') {
          setIcon(suggestionFlair, 'lucide-bookmark');
          suggestionNote.setText(
            this.getSuggestionText(item.item.path ?? '') + (item.item.subpath ?? '')
          );
        } else if (item.item?.type === 'folder') {
          setIcon(suggestionFlair, 'lucide-bookmark');
          suggestionNote.setText(this.getSuggestionText(item.item.path ?? ''));
        } else if (item.item?.type === 'search') {
          setIcon(suggestionFlair, 'lucide-search');
          suggestionNote.setText(item.item.query ?? '');
        } else if (item.item?.type === 'graph') {
          setIcon(suggestionFlair, 'lucide-git-fork');
          suggestionNote.detach();
        } else if (item.item?.type === 'url') {
          const webViewerPlugin = this.app.internalPlugins.getEnabledPluginById('webviewer');
          if (webViewerPlugin) {
            suggestionFlair.addClass('webviewer-favicon-container');
            invokeAsyncSafely(() => webViewerPlugin.db.setIcon(suggestionFlair, item.item?.url ?? ''));
          } else {
            setIcon(suggestionFlair, 'globe-2');
          }
          suggestionNote.setText(item.item.url ?? '');
        }
      });
    }
  }

  protected abstract onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void>;

  protected registerCommandWithCheckbox(options: RegisterCommandWithCheckboxOptions): Instruction {
    const { initCheckbox, key, modifiers, purpose } = options;

    const keys = [...(modifiers ?? []), key].map((key2) => key2.toLowerCase()).join(' ');

    requestAnimationFrame(() => {
      const instructionEl = this.instructionsEl.findAll('span').find((span) => span.textContent === purpose);

      if (!instructionEl) {
        throw new Error(`Instruction ${purpose} not found`);
      }

      const checkboxEl: HTMLInputElement = instructionEl.createEl('input', { type: 'checkbox' });
      initCheckbox(checkboxEl);

      this.scope.register(modifiers ?? [], key, () => {
        if (checkboxEl.disabled) {
          return;
        }
        checkboxEl.checked = !checkboxEl.checked;
        checkboxEl.trigger('change');
      });
    });

    return {
      command: keys,
      purpose
    };
  }

  private addAliasMatches(file: TFile, searchFn: SearchFn, items: Item[], isUserIgnored: boolean, scoreStep: number): void {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
      return;
    }

    const aliases = parseFrontMatterAliases(cache.frontmatter) ?? [];
    for (const alias of aliases) {
      const match = searchFn(alias);
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

  private getDisplayText(selectedItem: Item): string {
    switch (selectedItem.type) {
      case 'alias':
      case 'file':
        return trimMarkdownExtension(selectedItem.file?.path ?? '');
      case 'bookmark':
        return selectedItem.bookmarkPath ?? '';
      case 'unresolved':
        return selectedItem.linktext ?? '';
      default:
        return '';
    }
  }

  private getRecentFiles(): Item[] {
    const recentFilePaths = this.app.workspace.getRecentFiles({
      showImages: this.shouldShowImages,
      showMarkdown: this.shouldShowMarkdown,
      showNonAttachments: this.shouldShowNonAttachments,
      showNonImageAttachments: this.shouldShowNonImageAttachments
    });

    const items: Item[] = [];
    for (const filePath of recentFilePaths) {
      const file = this.app.vault.getFileByPath(filePath);
      if (file && !this.app.metadataCache.isUserIgnored(file.path) && this.shouldIncludeFile(file)) {
        items.push({ file, match: { matches: [], score: 0 }, type: 'file' });
      }
    }
    return items;
  }

  private getSuggestionText(text: string): string {
    let suggestionText = trimMarkdownExtension(text);
    if (!this.composer.shouldAllowOnlyCurrentFolder) {
      return suggestionText;
    }

    suggestionText = trimStart(suggestionText, this.composer.sourceFile.parent?.getParentPrefix() ?? '');
    return suggestionText;
  }

  private handleCreateButtonClick(evt: MouseEvent): void {
    this.onChooseSuggestion(null, evt);
    this.close();
  }

  private handleTabKey(evt: KeyboardEvent): MaybeReturn<false> {
    if (evt.isComposing) {
      return;
    }
    const selectedItem = this.chooser.values?.[this.chooser.selectedItem];
    if (!selectedItem) {
      return false;
    }
    let displayText = truncatePathToLastMatch(this.getDisplayText(selectedItem), selectedItem.match.matches as [number, number][] | undefined);
    if (displayText === this.inputEl.value) {
      displayText += '/';
    }
    this.inputEl.value = displayText;
    this.inputEl.trigger('input');
    return false;
  }

  private searchBookmarks(searchFn: SearchFn): Item[] {
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
      const match = searchFn(bookmarkPath);
      if (match) {
        items.push({
          bookmarkPath,
          item: bookmarkItem,
          match,
          type: 'bookmark'
        });
      }
    }

    traverseBookmarks(bookmarksPlugin.items, (bookmarkItem: BookmarkItem, parentPath: string) => {
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
    });

    return items;
  }

  private searchFiles(_query: string, searchFn: SearchFn): Item[] {
    const SCORE_STEP = 10;
    const files = this.app.vault.getFiles().filter(this.shouldIncludeFile.bind(this));
    const items: Item[] = [];

    for (const file of files) {
      const isUserIgnored = this.app.metadataCache.isUserIgnored(file.path);
      const match = searchFilePath(searchFn, trimMarkdownExtension(file.path));
      if (match) {
        if (isUserIgnored) {
          match.score -= SCORE_STEP;
        }
        items.push({ downranked: isUserIgnored, file, match, type: 'file' });
      }

      if (this.shouldShowAlias) {
        this.addAliasMatches(file, searchFn, items, isUserIgnored, SCORE_STEP);
      }
    }

    return items;
  }

  private searchUnresolvedLinks(searchFn: SearchFn): Item[] {
    if (!this.shouldShowUnresolved) {
      return [];
    }

    const unresolvedLinks = new Set<string>();
    for (const unresolvedLinkObj of Object.values(this.app.metadataCache.unresolvedLinks)) {
      for (const unresolvedLink of Object.keys(unresolvedLinkObj)) {
        if (this.composer.shouldAllowOnlyCurrentFolder && !unresolvedLink.startsWith(this.composer.sourceFile.parent?.getParentPrefix() ?? '')) {
          continue;
        }
        unresolvedLinks.add(unresolvedLink);
      }
    }

    const items: Item[] = [];
    for (const unresolvedLink of unresolvedLinks) {
      const match = searchFn(unresolvedLink);
      if (match) {
        items.push({ linktext: unresolvedLink, match, type: 'unresolved' });
      }
    }

    return items;
  }

  private shouldIncludeFile(file: TFile): boolean {
    if (file === this.composer.sourceFile) {
      return false;
    }

    if (this.composer.shouldAllowOnlyCurrentFolder && file.parent !== this.composer.sourceFile.parent) {
      return false;
    }

    if (file.extension === 'md') {
      return this.shouldShowMarkdown;
    }
    if (file.extension === 'canvas' || file.extension === 'base') {
      return this.shouldShowNonAttachments;
    }
    if (IMAGE_EXTENSIONS.includes(file.extension)) {
      return this.shouldShowImages;
    }

    if (this.shouldShowAllTypes) {
      return true;
    }

    if (this.shouldShowNonImageAttachments) {
      const registry = this.context === 'view' ? this.app.viewRegistry : this.app.embedRegistry;
      return registry.isExtensionRegistered(file.extension);
    }

    return false;
  }
}

function animateElement(element: HTMLElement, animation: Animation, onComplete?: () => void): void {
  stopAnimation(element);

  element.setCssProps(animation.from);

  const animationState: AnimationState = {
    complete: onComplete,
    fn: () => {
      stopAnimation(element);
    },
    props: animation,
    timer: 0,
    win: element.ownerDocument.defaultView ?? window
  };

  animationStates.set(element, animationState);

  if (pendingAnimations === null) {
    pendingAnimations = [];
    setTimeout(() => {
      forceReflow();

      const animations = pendingAnimations;
      pendingAnimations = null;

      for (const animationFn of animations ?? []) {
        animationFn();
      }
    }, 0);
  }

  pendingAnimations.push(() => {
    element.style.transition = `all ${String(animation.duration)}ms ${animation.fn}`;
    element.style.transitionProperty = Object.keys(animation.from).join(', ');

    element.setCssProps(animation.to);

    element.addEventListener('transitionend', (event) => {
      if (event.target === element) {
        animationState.fn();
      }
    });

    const ANIMATION_DELAY = 50;
    animationState.timer = animationState.win.setTimeout(animationState.fn, animation.duration + ANIMATION_DELAY);
  });
}

function forceReflow(): void {
  if (document.body.offsetHeight) {
    noop();
  }
}

function stopAnimation(element: HTMLElement, skipComplete = false): void {
  const animationState = animationStates.get(element);
  animationStates.delete(element);

  if (animationState) {
    element.style.transition = '';
    element.style.transitionProperty = '';

    element.setCssProps(animationState.props.end);

    animationState.win.clearTimeout(animationState.timer);
    element.removeEventListener('transitionend', animationState.fn);

    if (!skipComplete && animationState.complete) {
      animationState.complete();
    }
  }
}

function trimMarkdownExtension(path: string): string {
  return trimEnd(path, '.md');
}

function truncatePathToLastMatch(path: string, matches?: SearchMatches): string {
  if (matches && matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
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

const animationStates = new WeakMap<HTMLElement, AnimationState>();
let pendingAnimations: (() => void)[] | null = null;

const IMAGE_EXTENSIONS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'];

function adjustMatchPositions(matches: SearchMatches | undefined, pathPrefixLength: number): void {
  for (const match of matches ?? []) {
    match[0] += pathPrefixLength;
    match[1] += pathPrefixLength;
  }
}

function searchFilePath(searchFn: SearchFn, filePath: string): null | SearchResult {
  const fileName = basename(filePath);
  let match = searchFn(fileName);

  if (match) {
    adjustMatchPositions(match.matches, filePath.length - fileName.length);
    return match;
  }
  match = searchFn(filePath);
  if (match) {
    match.score--;
  }
  return match;
}

function traverseBookmarks(bookmarkItems: BookmarkItem[], callback: (bookmarkItem: BookmarkItem, path: string) => unknown, parentPath = ''): void {
  for (const bookmarkItem of bookmarkItems) {
    if (callback(bookmarkItem, parentPath)) {
      return;
    }

    if (bookmarkItem.type === 'group' && bookmarkItem.items) {
      traverseBookmarks(bookmarkItem.items, callback, `${parentPath + bookmarkItem.title}/`);
    }
  }
}
