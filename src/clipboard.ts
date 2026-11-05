/** Clipboard API + запасной путь для браузеров и WebView без него. */
export async function copyText(text: string): Promise<boolean> {
  if (!text || typeof document === 'undefined') return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* Пробуем копирование через выделение. */ }
  }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.tabIndex = -1;
  field.setAttribute('aria-hidden','true');
  field.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px;';
  document.body.appendChild(field);
  try {
    field.focus({preventScroll:true});
    field.select();
    field.setSelectionRange(0,text.length);
    return document.execCommand('copy');
  } catch { return false; }
  finally {
    field.remove();
    active?.focus({preventScroll:true});
    if(selection){selection.removeAllRanges();ranges.forEach(r=>selection.addRange(r));}
  }
}
