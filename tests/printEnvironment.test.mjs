import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['src/printEnvironment.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const detect = (nav = {}, win = {}) => {
  const context = { module: { exports: {} }, navigator: { userAgent: '', platform: '', maxTouchPoints: 0, ...nav }, window: { matchMedia: () => ({ matches: false }), ...win } };
  vm.runInNewContext(output.outputFiles[0].text, context);
  return context.module.exports.isIOSStandalonePrint();
};
test('PDF-системное меню только для iPhone/iPad PWA, без изменения браузера и нативных приложений', () => {
  assert.equal(detect({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)', standalone: true }), true);
  assert.equal(detect({ userAgent: 'iPhone', standalone: false }), false);
  assert.equal(detect({ userAgent: 'iPhone' }, { matchMedia: () => ({ matches: true }) }), true);
  assert.equal(detect({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5, standalone: true }), true);
  assert.equal(detect({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0, standalone: true }), false);
  assert.equal(detect({ userAgent: 'Android', standalone: true }), false);
  assert.equal(detect({ userAgent: 'iPhone', standalone: true }, { Capacitor: { isNativePlatform: () => true } }), false);
  assert.equal(detect({ userAgent: 'iPhone', standalone: true }, { finuchetShell: {} }), false);
});
