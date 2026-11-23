import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/watchlist.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { watchlistSearchQuery: query, watchlistCanSearch: allowed, watchlistCanSubmit: canSubmit, watchlistUiVisible: visible,
  watchlistCanRequestAccess: canRequest } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);

test('автопроверка: полное имя, одинаковые регистр/Ё/пробелы; цифры и незаконченный ввод не отправляются', () => {
  const expected = { name: 'семенов тест тестович', birthYear: null };
  for (const name of ['СЕМЁНОВ ТЕСТ ТЕСТОВИЧ', '  сЕмЕнов   Тест  Тестович ', 'Семёнов\u00a0Тест Тестович']) assert.deepEqual(query(name), expected);
  for (const name of ['', 'Семёнов', 'Семёнов Т', 'Семёнов Т.', '+7 999 1234567', '0531', 'Семёнов 1988', 'Семёнов <script>']) assert.equal(query(name), null);
  assert.deepEqual(query('Ли Анна'), { name: 'ли анна', birthYear: null });
  assert.deepEqual(query('Семёнов Тест Тестович', '1988'), { ...expected, birthYear: 1988 });
  for (const year of ['1', '198', '1899', 'abcd', String(new Date().getUTCFullYear() + 1)]) assert.equal(query('Семёнов Тест Тестович', year), null);
});

test('быстрое добавление использует право отправки, независимо от права поиска', () => {
  const status = { enabled: true, accepted: true, submissionsPaused: false, searchPaused: true, access: { status: 'granted', canSearch: false, canSubmit: true } };
  assert.equal(canSubmit(status), true);
  for (const change of [{ enabled: false }, { accepted: false }, { submissionsPaused: true }, { access: null }, { access: { status: 'requested', canSubmit: true } }, { access: { status: 'granted', canSubmit: false } }]) assert.equal(canSubmit({ ...status, ...change }), false);
});

test('локальное включение проверки требует всех признаков допуска; сервер остаётся источником прав', () => {
  const status = { enabled: true, accepted: true, searchPaused: false, access: { status: 'granted', canSearch: true } };
  assert.equal(allowed(status), true);
  for (const change of [{ enabled: false }, { accepted: false }, { searchPaused: true }, { access: null }, { access: { status: 'requested', canSearch: true } }, { access: { status: 'granted', canSearch: false } }]) assert.equal(allowed({ ...status, ...change }), false);
  assert.equal(allowed(null), false);
});


test('раздел видят все вошедшие пользователи', () => {
  for (const role of ['admin', 'manager', 'employee', 'investor']) assert.equal(visible({ role }), true);
  assert.equal(visible({}), false);
  assert.equal(visible(null), false);
});

test('открытие меню сохраняет серверные ограничения для сотрудников и инвесторов', () => {
  for (const role of ['admin', 'manager']) assert.equal(canRequest({ role }), true);
  for (const role of ['employee', 'investor']) assert.equal(canRequest({ role }), false);
  assert.equal(canRequest(null), false);
});
