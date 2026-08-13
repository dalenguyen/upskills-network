import { z } from 'zod';
import { CloudRunExecutorSchema } from './executor-options.model';

export type CloudRunExecutorOptions = z.input<typeof CloudRunExecutorSchema>;
