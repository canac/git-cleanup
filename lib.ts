export const isNotNull = <T>(item: T | null): item is T => item !== null;

/**
 * Remove the prefix from the input string if it starts with the prefix. Return null if it does not
 * start with the prefix.
 */
export const stripPrefix = (input: string, prefix: string): string | null => {
  return input.startsWith(prefix) ? input.slice(prefix.length) : null;
};
