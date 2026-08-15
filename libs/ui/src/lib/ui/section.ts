import { Component, Input } from '@angular/core';

/** Inner content column. Most sections read better narrower than the viewport. */
export type SectionWidth = 'narrow' | 'default' | 'wide';

/** Vertical rhythm. Sections that sit back-to-back use `compact` so two full
 * paddings don't stack into a dead band of whitespace. */
export type SectionSpacing = 'none' | 'compact' | 'default' | 'roomy';

const sectionWidthClasses: Record<SectionWidth, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-6xl',
  wide: 'max-w-7xl',
};

const sectionSpacingClasses: Record<SectionSpacing, string> = {
  none: '',
  compact: 'py-12 sm:py-16',
  default: 'py-16 sm:py-20 lg:py-24',
  roomy: 'py-20 sm:py-24 lg:py-32',
};

@Component({
  selector: 'ui-section',
  imports: [],
  host: { class: 'block' },
  template: `
    <section [class]="sectionClasses">
      <div [class]="containerClasses">
        <ng-content></ng-content>
      </div>
    </section>
  `,
})
export class Section {
  @Input() width: SectionWidth = 'default';
  @Input() spacing: SectionSpacing = 'default';

  get sectionClasses(): string {
    return [
      'px-4 font-sans sm:px-6 lg:px-8',
      sectionSpacingClasses[this.spacing],
    ]
      .filter(Boolean)
      .join(' ');
  }

  get containerClasses(): string {
    return `mx-auto w-full ${sectionWidthClasses[this.width]}`;
  }
}
