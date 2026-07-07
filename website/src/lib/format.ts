/** Shared formatters — one instance per build, one convention site-wide. */
export const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
