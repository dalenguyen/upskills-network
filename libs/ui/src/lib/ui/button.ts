import { Component, Input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-600 text-white shadow-sm shadow-indigo-600/25 hover:bg-indigo-500 hover:shadow-md hover:shadow-indigo-600/30 active:bg-indigo-700',
  secondary:
    'border border-indigo-600 bg-white text-indigo-600 shadow-sm hover:bg-indigo-50 active:bg-indigo-100',
  ghost: 'text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100',
};

/** Heights are fixed so a button can sit flush beside an input of the same
 * size without the two disagreeing by a few pixels. */
const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-6 text-base',
};

@Component({
  selector: 'ui-button',
  imports: [],
  // `inline-flex` on the host lets the inner button stretch to whatever height
  // the surrounding layout hands it. Left as the default `inline`, the button
  // sits vertically misaligned next to same-height siblings such as inputs.
  host: { class: 'inline-flex' },
  template: `
    <button [attr.type]="type" [disabled]="disabled" [class]="classes">
      <ng-content></ng-content>
    </button>
  `,
})
export class Button {
  @Input() variant: ButtonVariant = 'primary';
  @Input() size: ButtonSize = 'md';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() disabled = false;

  get classes(): string {
    return [
      // `whitespace-nowrap` keeps the label on one line when the button is a
      // flex item that a greedy sibling would otherwise squeeze.
      'inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg font-sans font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60',
      buttonSizeClasses[this.size],
      buttonVariantClasses[this.variant],
    ].join(' ');
  }
}
