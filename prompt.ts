import type { $Type, MultiSelectOption } from "@david/dax";

interface PromptResult<Option extends MultiSelectOption> {
  /** Options that were selected */
  selected: Option[];

  /** Options that were not selected */
  unselected: Option[];

  /** Options that started out selected but were deselected by the user */
  deselected: Option[];
}

/**
 * Extract the text from an option.
 */
const getText = (option: MultiSelectOption): string => option.text;

/**
 * Prompt the user to select some options. Return the selected, unselected, and deselected options.
 */
export const prompt = async <Option extends MultiSelectOption>(
  $: $Type,
  message: string,
  options: Option[],
  getOptionText: (option: Option) => string = getText,
): Promise<PromptResult<Option>> => {
  const selectedIndexes = new Set(
    options.length === 0 ? [] : await $.multiSelect({
      message,
      options: options.map((option) => ({
        text: getOptionText(option),
        selected: option.selected,
      })),
    }),
  );

  return {
    selected: options.filter((_option, index) => selectedIndexes.has(index)),
    unselected: options.filter((_option, index) => !selectedIndexes.has(index)),
    deselected: options.filter((option, index) =>
      !selectedIndexes.has(index) && option.selected === true
    ),
  };
};
