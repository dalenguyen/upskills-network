export type Command = string | boolean | undefined;

export const buildCommand = (commands: Command[]): string => {
  return commands.filter(Boolean).join(' ');
};
