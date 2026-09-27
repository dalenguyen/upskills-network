import { InjectionToken } from '@angular/core';

/**
 * The current time, as a page reads it.
 *
 * Injected rather than called as `new Date()` so a spec can pin it: whether an
 * event has ended depends on today's date, and a fixture dated "next month"
 * would otherwise start failing the month after it was written.
 */
export const CLOCK = new InjectionToken<() => Date>('CLOCK', {
  providedIn: 'root',
  factory: () => () => new Date(),
});
