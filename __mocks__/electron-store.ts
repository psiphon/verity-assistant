/** In-memory stand-in for electron-store, so main-process tests never touch
 * a real config file (isolated, fast, no risk of clobbering the real app's
 * settings) while still exercising the actual get/set/store semantics
 * rapport.ts and memory.ts depend on. */
export default class Store<T extends Record<string, unknown>> {
  private data: Record<string, unknown>

  constructor(opts: { defaults?: T } = {}) {
    this.data = structuredClone(opts.defaults ?? {})
  }

  get<K extends keyof T>(key: K, fallback?: T[K]): T[K] {
    return (key in this.data ? this.data[key as string] : fallback) as T[K]
  }

  set<K extends keyof T>(keyOrObj: K | Partial<T>, value?: T[K]): void {
    if (typeof keyOrObj === 'string') {
      this.data[keyOrObj] = value
    } else {
      Object.assign(this.data, keyOrObj)
    }
  }

  get store(): T {
    return this.data as T
  }
}
