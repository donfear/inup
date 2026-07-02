export class InflightMap<T> {
  private map = new Map<string, Promise<T>>()

  async dedupe(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.map.get(key)
    if (existing) {
      return await existing
    }

    const promise = fn().finally(() => {
      this.map.delete(key)
    })
    this.map.set(key, promise)
    return await promise
  }

  clear(): void {
    this.map.clear()
  }
}
