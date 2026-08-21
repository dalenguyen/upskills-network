import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { provideClientHydration } from '@angular/platform-browser';
import { provideFileRouter, requestContextInterceptor } from '@analogjs/router';

import { provideFirebaseAuth } from './auth/firebase-auth-client';
import { invalidSessionInterceptor } from './auth/invalid-session-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    provideFileRouter(),
    // Browser-only: a no-op during SSR, where authorization reads the
    // `__session` cookie rather than any client SDK state.
    provideFirebaseAuth(),
    provideClientHydration(),
    provideHttpClient(
      withFetch(),
      withInterceptors([requestContextInterceptor, invalidSessionInterceptor]),
    ),
  ],
};
