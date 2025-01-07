import type { $Type, MultiSelectOption } from "@david/dax";

/**
 * Prompt the user to select some options. Return a tuple of the selected options and the unselected
 * options.
 */
export const prompt = async (
  $: $Type,
  message: string,
  options: MultiSelectOption[],
): Promise<[MultiSelectOption[], MultiSelectOption[]]> => {
  const selectedIndexes = new Set(
    options.length === 0 ? [] : await $.multiSelect({ message, options }),
  );

  return [
    options.filter((_option, index) => selectedIndexes.has(index)),
    options.filter((_option, index) => !selectedIndexes.has(index)),
  ];
};
