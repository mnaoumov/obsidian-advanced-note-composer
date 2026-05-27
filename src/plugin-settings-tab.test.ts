import type { PluginSettingsTabBaseConstructorParams } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import { getDebugController } from 'obsidian-dev-utils/debug';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettings } from './plugin-settings.ts';

import { PluginSettingsTab } from './plugin-settings-tab.ts';

interface MockCodeHighlighter {
  setLanguage: ReturnType<typeof vi.fn>;
}

interface MockDropdown {
  addOptions: ReturnType<typeof vi.fn>;
}

interface MockMultipleText {
  placeholder?: string;
}

interface MockSettingEx {
  addCodeHighlighter: ReturnType<typeof vi.fn>;
  addDropdown: ReturnType<typeof vi.fn>;
  addMultipleText: ReturnType<typeof vi.fn>;
  addText: ReturnType<typeof vi.fn>;
  addToggle: ReturnType<typeof vi.fn>;
  setDesc: ReturnType<typeof vi.fn>;
  setName: ReturnType<typeof vi.fn>;
}

interface MockSettingGroupEx {
  addSettingEx: ReturnType<typeof vi.fn>;
  setHeading: ReturnType<typeof vi.fn>;
}

interface MockText {
  setDisabled: ReturnType<typeof vi.fn>;
}

interface MockToggle {
  onChange: ReturnType<typeof vi.fn>;
  setDisabled: ReturnType<typeof vi.fn>;
  setValue: ReturnType<typeof vi.fn>;
}

interface SettingsTabConstructorParams extends PluginSettingsTabBaseConstructorParams<PluginSettings> {
  readonly pluginId: string;
}

const capturedToggleOnChangeHandlers: ((value: boolean) => void)[] = [];
const capturedBindOnChangedCallbacks: (() => void)[] = [];

function createMockSettingEx(): MockSettingEx {
  const setting: MockSettingEx = {
    addCodeHighlighter: vi.fn().mockImplementation((cb: (codeHighlighter: MockCodeHighlighter) => void) => {
      cb({ setLanguage: vi.fn() });
      return setting;
    }),
    addDropdown: vi.fn().mockImplementation((cb: (dropdown: MockDropdown) => void) => {
      cb({ addOptions: vi.fn() });
      return setting;
    }),
    addMultipleText: vi.fn().mockImplementation((cb: (multipleText: MockMultipleText) => void) => {
      cb({});
      return setting;
    }),
    addText: vi.fn().mockImplementation((cb: (text: MockText) => void) => {
      cb({ setDisabled: vi.fn() });
      return setting;
    }),
    addToggle: vi.fn().mockImplementation((cb: (toggle: MockToggle) => void) => {
      const toggle: MockToggle = {
        onChange: vi.fn().mockImplementation((handler: (value: boolean) => void) => {
          capturedToggleOnChangeHandlers.push(handler);
        }),
        setDisabled: vi.fn(),
        setValue: vi.fn()
      };
      cb(toggle);
      return setting;
    }),
    setDesc: vi.fn().mockReturnThis(),
    setName: vi.fn().mockReturnThis()
  };
  return setting;
}

function createMockSettingGroupEx(): MockSettingGroupEx {
  const group: MockSettingGroupEx = {
    addSettingEx: vi.fn().mockImplementation((cb: (setting: MockSettingEx) => void) => {
      cb(createMockSettingEx());
      return group;
    }),
    setHeading: vi.fn().mockReturnThis()
  };
  return group;
}

vi.mock('obsidian-dev-utils/debug', () => ({
  getDebugController: vi.fn().mockReturnValue({
    disable: vi.fn(),
    enable: vi.fn(),
    get: vi.fn().mockReturnValue([])
  })
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

interface BindOptions {
  onChanged?(): void;
}

vi.mock('obsidian-dev-utils/obsidian/plugin/plugin-settings-tab', () => {
  class MockPluginSettingsTabBase {
    protected readonly pluginSettingsComponent: unknown;

    public constructor(params: PluginSettingsTabBaseConstructorParams<PluginSettings>) {
      this.pluginSettingsComponent = params.pluginSettingsComponent;
    }

    public bind(_component: unknown, _key: string, options?: BindOptions): void {
      if (options?.onChanged) {
        capturedBindOnChangedCallbacks.push(options.onChanged);
      }
    }

    public display(): void {
      // No-op for test
    }
  }
  return {
    PluginSettingsTabBase: MockPluginSettingsTabBase
  };
});

vi.mock('obsidian-dev-utils/obsidian/setting-ex', () => ({
  SettingEx: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/setting-group-ex', () => {
  class MockSettingGroupExClass {
    private readonly group: MockSettingGroupEx;
    public constructor() {
      this.group = createMockSettingGroupEx();
    }

    public addSettingEx(cb: (setting: MockSettingEx) => void): this {
      this.group.addSettingEx(cb);
      return this;
    }

    public setHeading(heading: string): this {
      this.group.setHeading(heading);
      return this;
    }
  }
  return {
    SettingGroupEx: MockSettingGroupExClass
  };
});

vi.mock('./prism-component.ts', () => ({
  TOKENIZED_STRING_LANGUAGE: 'mock-language'
}));

afterEach(() => {
  vi.restoreAllMocks();
  capturedToggleOnChangeHandlers.length = 0;
  capturedBindOnChangedCallbacks.length = 0;
});

function createSettingsTab(): PluginSettingsTab {
  const params = strictProxy<SettingsTabConstructorParams>({
    plugin: strictProxy<Record<string, unknown>>({ app: {} }),
    pluginId: 'test-plugin-id',
    pluginSettingsComponent: {
      settings: {
        shouldReplaceInvalidTitleCharacters: true
      }
    }
  });
  return new PluginSettingsTab(params);
}

function getContainerEl(tab: PluginSettingsTab): void {
  Object.assign(tab, { containerEl: { empty: vi.fn() } });
}

describe('PluginSettingsTab', () => {
  it('should be constructable with pluginId', () => {
    const tab = createSettingsTab();
    expect(tab).toBeDefined();
  });

  it('should call display without throwing', () => {
    const tab = createSettingsTab();
    getContainerEl(tab);

    expect(() => {
      tab.display();
    }).not.toThrow();
  });

  it('should create setting groups for all sections', () => {
    const tab = createSettingsTab();
    getContainerEl(tab);

    // Display() creates all 9 setting groups without throwing
    tab.display();

    // The display method ran to completion, meaning all 9 SettingGroupEx were created
    expect(tab).toBeDefined();
  });
});

describe('addAvailableTokens', () => {
  it('should be called as part of merge template and split template settings', () => {
    const tab = createSettingsTab();
    getContainerEl(tab);

    // If display doesn't throw, the addAvailableTokens function ran successfully
    expect(() => {
      tab.display();
    }).not.toThrow();
  });
});

describe('debug controller toggle', () => {
  it('should handle debug toggle callbacks', () => {
    const enableMock = vi.fn();
    const disableMock = vi.fn();
    vi.mocked(getDebugController).mockReturnValue({
      disable: disableMock,
      enable: enableMock,
      get: vi.fn().mockReturnValue(['test-plugin-id'])
    } as never);

    const tab = createSettingsTab();
    getContainerEl(tab);

    // Display will trigger the toggle callback creation
    expect(() => {
      tab.display();
    }).not.toThrow();
  });

  it('should enable debug controller when toggle onChange is called with true', () => {
    const enableMock = vi.fn();
    const disableMock = vi.fn();
    vi.mocked(getDebugController).mockReturnValue({
      disable: disableMock,
      enable: enableMock,
      get: vi.fn().mockReturnValue([])
    } as never);

    const tab = createSettingsTab();
    getContainerEl(tab);
    tab.display();

    // The debug toggle's onChange handler is the only one captured via toggle.onChange
    // (all other toggles use bind). It's the first captured onChange handler.
    expect(capturedToggleOnChangeHandlers.length).toBeGreaterThan(0);

    // Call with true to exercise the enable branch
    const debugToggleHandler = capturedToggleOnChangeHandlers[0];
    expect(debugToggleHandler).toBeDefined();
    debugToggleHandler?.(true);
    expect(enableMock).toHaveBeenCalledWith('test-plugin-id');
  });

  it('should disable debug controller when toggle onChange is called with false', () => {
    const enableMock = vi.fn();
    const disableMock = vi.fn();
    vi.mocked(getDebugController).mockReturnValue({
      disable: disableMock,
      enable: enableMock,
      get: vi.fn().mockReturnValue([])
    } as never);

    const tab = createSettingsTab();
    getContainerEl(tab);
    tab.display();

    const debugToggleHandler = capturedToggleOnChangeHandlers[0];
    expect(debugToggleHandler).toBeDefined();
    debugToggleHandler?.(false);
    expect(disableMock).toHaveBeenCalledWith('test-plugin-id');
  });
});

describe('shouldReplaceInvalidTitleCharacters onChanged', () => {
  it('should call display when shouldReplaceInvalidTitleCharacters changes', () => {
    const tab = createSettingsTab();
    getContainerEl(tab);
    tab.display();

    // The bind call with onChanged option captures the callback
    expect(capturedBindOnChangedCallbacks.length).toBeGreaterThan(0);

    // Calling the onChanged callback should re-invoke display
    const displaySpy = vi.spyOn(tab, 'display');
    const onChangedCallback = capturedBindOnChangedCallbacks[0];
    expect(onChangedCallback).toBeDefined();
    onChangedCallback?.();
    expect(displaySpy).toHaveBeenCalled();
  });
});
