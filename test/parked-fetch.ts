/** A request that never resolves, but rejects like fetch does when aborted. */
export const parked = (signal?: AbortSignal) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      { once: true },
    );
  });
