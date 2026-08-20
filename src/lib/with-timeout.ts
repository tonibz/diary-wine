/**
 * Guard any promise so a hanging request can never leave a spinner running
 * forever. Rejects with a plain, user-showable message on timeout.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms = 30_000,
  message = "That took too long — please try again",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
