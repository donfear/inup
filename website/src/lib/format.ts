/** Shared formatters — one instance per build, one convention site-wide. */
export const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const words = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

/**
 * Small counts as words, so headline copy can be derived from the data
 * instead of typed out and left to drift ("Twelve capabilities. Nine
 * tools."). Anything past twelve falls back to the numeral.
 */
export function numberWord(n: number, { capitalize = false } = {}): string {
  const word = words[n] ?? String(n);
  return capitalize ? word[0]!.toUpperCase() + word.slice(1) : word;
}
