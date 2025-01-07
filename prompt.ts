import type { $Type, MultiSelectOption } from "@david/dax";

interface PromptResult {
  /** Options that were selected */
  selected: string[];

  /** Options that were not selected */
  unselected: string[];

  /** Options that started out selected but were deselected by the user */
  deselected: string[];
}

/**
 * Extract the text from an option.
 */
const getText = (option: MultiSelectOption): string => option.text;

/**
 * Prompt the user to select some options. Return a tuple of the selected options and the unselected
 * options.
 */
export const prompt = async (
  $: $Type,
  message: string,
  options: MultiSelectOption[],
): Promise<PromptResult> => {
  const selectedIndexes = new Set(
    options.length === 0 ? [] : await $.multiSelect({ message, options }),
  );

  const selected = options.filter((_option, index) => selectedIndexes.has(index));
  const unselected = options.filter((_option, index) => !selectedIndexes.has(index));
  const deselected = options.filter((option, index) =>
    !selectedIndexes.has(index) && option.selected === true
  );

  return {
    selected: selected.map((option) => getText(option)),
    unselected: unselected.map((option) => getText(option)),
    deselected: deselected.map((option) => getText(option)),
  };
};
