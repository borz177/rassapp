/**
 * Если запрос не отвечает за указанное время — отклоняет с ошибкой.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, context = 'request'): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`TIMEOUT: ${context} took more than ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId!);
  });
}