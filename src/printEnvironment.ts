/** Веб-приложение с экрана «Домой». Нативная iOS-сборка имеет отдельный путь. */
export const isIOSStandalonePrint = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if ((window as any).Capacitor?.isNativePlatform?.() || (window as any).finuchetShell) return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && (!!(navigator as Navigator & { standalone?: boolean }).standalone || !!window.matchMedia?.('(display-mode: standalone)').matches);
};
