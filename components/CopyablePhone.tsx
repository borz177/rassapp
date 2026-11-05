import React from 'react';
import { Copy } from 'lucide-react';
import { copyText } from '../src/clipboard';
import { toast } from '../src/toast';

/** Номер копируется как записан: без изменения кода страны или добавочных цифр. */
export default function CopyablePhone({phone,children,className=''}: {
  phone?: string | number | null; children?: React.ReactNode; className?: string;
}) {
  const value = String(phone ?? '').trim();
  if(!/\d/.test(value))return <span className={className}>{children || value || '—'}</span>;
  return <button type="button" title="Скопировать номер" aria-label={`Скопировать номер ${value}`}
    className={`inline-flex max-w-full items-center gap-1 rounded text-left align-middle cursor-copy select-text touch-manipulation hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
    onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')e.stopPropagation();}}
    onKeyUp={e=>{if(e.key==='Enter'||e.key===' ')e.stopPropagation();}}
    onClick={async e=>{
      e.preventDefault();e.stopPropagation();
      if(await copyText(value))toast.success('Номер скопирован');
      else toast.error('Не удалось скопировать номер');
    }}>
    <span className="min-w-0 break-words">{children || value}</span>
    <Copy size={12} aria-hidden className="shrink-0 opacity-40" />
  </button>;
}
