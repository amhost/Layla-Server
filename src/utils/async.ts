/** Sleep that can be cancelled via an AbortSignal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Resolve once the signal is aborted (immediately if it already is). */
export function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Wait until `isDone()` is true, resolving on the given event or on timeout.
 * Resolves `true` when the event fired first, `false` when the timeout won.
 */
export function waitForEvent(
  target: EventTarget,
  eventName: string,
  timeoutMs: number,
  isDone: () => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (isDone()) {
      resolve(true);
      return;
    }

    const abortCtrl = new AbortController();

    const timer = setTimeout(() => {
      abortCtrl.abort();
      resolve(false);
    }, timeoutMs);

    target.addEventListener(
      eventName,
      () => {
        if (!isDone()) return;
        clearTimeout(timer);
        abortCtrl.abort();
        resolve(true);
      },
      { signal: abortCtrl.signal },
    );
  });
}
