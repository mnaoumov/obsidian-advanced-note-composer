import type { ActiveFileProvider } from '@mnaoumov/obsidian-lib/active-file-provider';
import type {
  CommandHandler,
  CommandHandlerRegistrationContext
} from '@mnaoumov/obsidian-lib/command-handlers/command-handler';
import type { MenuEventRegistrar } from '@mnaoumov/obsidian-lib/menu-event-registrar';
import type { DisposableEx } from '@mnaoumov/typescript-lib/disposable';

import { CallbackDisposable } from '@mnaoumov/typescript-lib/disposable';
import { noop } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';

/**
 * Parameters for {@link registerCommandHandlerStub}.
 */
export interface RegisterCommandHandlerStubParams {
  /**
   * The handler to register. Typed `object` so a test can pass the handler it narrowed to its own testable view.
   */
  readonly handler: object;

  /**
   * What the registering menu surface says about the command's submenu: `false` is a surface that wraps every
   * item in a plugin-titled entry of its own, `undefined` is the ordinary case where nothing sets it.
   */
  readonly shouldAddCommandToSubmenu?: boolean | undefined;
}

/**
 * Registers a command handler the way `obsidian-lib`'s command handler component does, with menu registrars
 * that record nothing, so a unit test can reach the handler's `onRegistered` override.
 *
 * @param params - The parameters.
 */
export async function registerCommandHandlerStub(params: RegisterCommandHandlerStubParams): Promise<void> {
  const menuEventRegistrar: MenuEventRegistrar = {
    registerEditorMenuEventHandler: registerMenuEventHandler,
    registerFileMenuEventHandler: registerMenuEventHandler,
    registerFilesMenuEventHandler: registerMenuEventHandler,
    registerMarkdownViewportMenuEventHandler: registerMenuEventHandler
  };
  const context: CommandHandlerRegistrationContext = {
    // Registration only stores the provider; a test that needs an active file drives the handler directly.
    activeFileProvider: castTo<ActiveFileProvider>({}),
    menuEventRegistrar,
    pluginName: 'Test plugin',
    shouldAddCommandToSubmenu: params.shouldAddCommandToSubmenu
  };
  await castTo<CommandHandler>(params.handler).onRegistered(context);
}

function registerMenuEventHandler(): DisposableEx {
  // The stub registrars record nothing, so there is nothing to unregister.
  return new CallbackDisposable({ callback: noop });
}
