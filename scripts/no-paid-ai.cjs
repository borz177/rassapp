// Локальные тесты: внешний fetch заблокирован, даже если в .env есть рабочий
// ключ. HTTP-заглушки на loopback доступны интеграционным тестам.
const nativeFetch = global.fetch;
global.fetch = (input, ...options) => {
  const value = typeof input === 'string' ? input : input.url || String(input);
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('PAID_NETWORK_BLOCKED: external requests disabled in local tests');
  }
  return nativeFetch(input, ...options);
};
for (const name of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) process.env[name] = '';
