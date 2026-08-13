import { logger } from '@nx/devkit';
import { exec, ExecOptions } from 'shelljs';

export interface Output {
  success: boolean;
  output: string;
}

export const execCommand = (
  command: string,
  // `async: false` selects shelljs' synchronous overload, which returns a
  // ShellString carrying the exit code (the async overload returns a
  // ChildProcess that has none).
  options: ExecOptions & { async?: false } = {},
): Output => {
  if (!options.silent) {
    logger.log('\nRunning: ', command);
  }

  const result = exec(command, options);
  return {
    success: result.code === 0,
    output: result.toString(),
  };
};
