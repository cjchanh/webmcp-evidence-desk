/**
 * Abort-signal plumbing shared by domain functions.
 * Domain stays pure: signals are only *observed*, never registered or awaited.
 */

export function abortError(): Error {
  // DOMException exists in browsers and Node >= 17.
  return new DOMException('The operation was aborted.', 'AbortError')
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
