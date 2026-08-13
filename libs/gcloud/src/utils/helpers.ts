export const objectToArray = (envVars: Record<string, string>): string[] =>
  Object.entries(envVars).map(([key, value]) => `${key}=${value}`);
