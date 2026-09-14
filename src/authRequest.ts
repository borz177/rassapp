/**
 * POST-запросы экрана входа и регистрации.
 *
 * Зачем отдельно от остального клиента. У входа нет токена и нет офлайн-очереди:
 * без ответа сервера человек просто не попадёт в приложение, и всё, что можно
 * сделать, — не потерять его попытку на ровном месте.
 *
 * А теряли. Регистрация — последний шаг после кода из письма: пока человек
 * вводит код, имя и пароль, проходит пара минут, и соединение успевает
 * закрыться (таймаут nginx или NAT мобильного оператора). Safari отправляет POST
 * в уже мёртвое соединение и сразу сдаётся с «Load failed»: небезопасный запрос
 * он сам не повторяет. Запрос до сервера не доходит, а человек видит английский
 * текст и не понимает, что нажать ещё раз — и есть решение.
 */

export const NETWORK_ERROR_TEXT = 'Нет связи с сервером. Проверьте интернет и нажмите ещё раз.';

export interface AuthRequestError extends Error {
  /** Код ответа сервера; отсутствует, если ответа не было вовсе */
  status?: number;
  /** true — сервер так и не ответил */
  network?: boolean;
}

/**
 * Обрыв без ответа сервера. У каждого браузера свой текст: Chrome пишет
 * «Failed to fetch», Safari — «Load failed», Firefox — «NetworkError…».
 * Раньше узнавали только хромовский вариант, и на iPhone на экран уходил сырой текст.
 */
export const isNetworkError = (error: any): boolean => {
  if (!error) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  if (error instanceof TypeError || error.name === 'TypeError') return true;
  return /Failed to fetch|Load failed|NetworkError|Network request failed|The network connection was lost/i
    .test(String(error.message || ''));
};

const makeError = (message: string, extra: Partial<AuthRequestError> = {}): AuthRequestError =>
  Object.assign(new Error(message), extra);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface PostJsonOptions {
  /** Текст, если сервер отказал без пояснения или ответил не JSON */
  fallbackMsg: string;
  /** Сколько раз повторить при обрыве. Только для запросов, которые безопасно повторять */
  retries?: number;
  retryDelayMs?: number;
  /** Вызывается перед каждым повтором — чтобы вызывающий знал, что повтор был */
  onRetry?: () => void;
  fetchImpl?: typeof fetch;
}

export const postJson = async (url: string, body: unknown, options: PostJsonOptions): Promise<any> => {
  const { fallbackMsg, retries = 0, retryDelayMs = 700, onRetry } = options;
  const doFetch = options.fetchImpl || fetch;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      if (attempt < retries) {
        onRetry?.();
        // Пауза короткая: новое соединение открывается быстро, а человек ждёт
        // с нажатой кнопкой. Её хватает, чтобы не долбить сразу в ту же яму.
        await wait(retryDelayMs);
        continue;
      }
      throw makeError(NETWORK_ERROR_TEXT, { network: true });
    }

    // Разбираем осторожно: на 502 от nginx приходит HTML, и res.json() падал
    // бы с непонятным «The string did not match the expected pattern».
    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!res.ok) {
      // Сервер ответил — значит, связь есть, и повторять незачем: отказ повторится.
      throw makeError((data && data.msg) || fallbackMsg, { status: res.status });
    }
    if (!data) throw makeError(fallbackMsg, { status: res.status });
    return data;
  }
};

/**
 * Регистрация дошла до сервера, а потерялся только ответ.
 *
 * Тогда повтор получит отказ, хотя аккаунт уже есть. Какой именно — зависит от
 * порядка проверок на сервере: код подтверждения удаляется сразу после создания
 * аккаунта, поэтому чаще придёт «Сначала запросите код», а не «Пользователь уже
 * существует». Ловим оба — и только если повтор действительно был.
 */
export const mayBeLostRegistration = (error: AuthRequestError, retried: boolean): boolean =>
  retried
  && error.status === 400
  && /уже существует|Сначала запросите код/i.test(error.message);
