/** Numeric primitives shared by the concurrency controllers and the TUI. */

export const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value))

export const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export const round2 = (value: number): number => roundTo(value, 2)

/** Exponentially weighted moving average, seeded by the first sample. */
export class Ewma {
  private ewma = 0
  private samples = 0

  constructor(private readonly alpha: number) {}

  update(sample: number): void {
    this.ewma = this.samples === 0 ? sample : this.alpha * sample + (1 - this.alpha) * this.ewma
    this.samples++
  }

  get value(): number {
    return this.ewma
  }

  get count(): number {
    return this.samples
  }
}
