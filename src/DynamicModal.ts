import type { MaybeReturn } from 'obsidian-dev-utils/Type';
import type { Promisable } from 'type-fest';

import {
  App,
  Modal
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';

export class DynamicModal extends Modal {
  private readonly buttonContainerEl: HTMLDivElement;

  public constructor(app: App) {
    super(app);

    this.containerEl.addClass('mod-confirmation');
    this.buttonContainerEl = this.modalEl.createDiv(
      'modal-button-container'
    );
  }

  public addButton(cssClasses: string | string[], text: string, onClick: (evt: MouseEvent) => Promisable<MaybeReturn<boolean>>): this {
    const normalizedCssClasses = Array.isArray(cssClasses) ? cssClasses : [cssClasses];

    const button = this.buttonContainerEl.createEl('button', {
      cls: normalizedCssClasses.join(' '),
      text
    });

    button.addEventListener('click', (evt) => {
      invokeAsyncSafely(async () => {
        try {
          button.addClass('mod-loading');
          const result = await onClick(evt);

          if (result) {
            this.close();
          }
        } catch (error) {
          console.error('Error in button click handler:', error);
        } finally {
          button.removeClass('mod-loading');
        }
      });
    });

    return this;
  }

  public addCancelButton(onCancel?: () => void): this {
    return this.addButton('mod-cancel', window.i18next.t('plugins.note-composer.dialogue-button-cancel'), () => {
      onCancel?.();
      return true;
    });
  }

  public addCheckbox(text: string, onClick: (evt: MouseEvent) => void): this {
    this.buttonContainerEl.createEl('label', { cls: 'mod-checkbox' }, (label) => {
      label
        .createEl('input', {
          attr: { tabindex: -1 },
          type: 'checkbox'
        });
      label.addEventListener('click', onClick);
      label.appendText(text);
    });

    return this;
  }
}
