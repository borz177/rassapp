import React from 'react';
import GlassSheet, { SheetSection } from './GlassSheet';
export default function AIStatementPreview({ rows, onClose, onPrepare }: { rows: any[]; onClose: () => void; onPrepare: (text: string) => void }) {
  return <GlassSheet title="Проверка выписки" onClose={onClose} cancelLabel="Закрыть">
    <SheetSection hint="Деньги ещё не записаны. Сверьте плательщика, договор, сумму и дату. Совпадение с существующим платежом может означать повтор.">
      {rows.map(row => <div key={row.row} className="p-4 border-b border-slate-200 dark:border-slate-700 last:border-0">
        <p className="font-semibold">{row.amount?.toLocaleString('ru-RU')} ₽ · {row.date}</p>
        {row.reference && <p className="text-xs text-slate-500 mt-1">{row.reference}</p>}
        {row.duplicateCount > 0 && <p className="text-sm text-amber-600 mt-2">Уже есть похожие платежи ({row.duplicateCount}). Проверьте их в договорах перед записью.</p>}
        {row.possibleDuplicates?.map((d: any) => <p key={d.contractId} className="text-sm mt-1">{d.customer} — {d.product}</p>)}
        {!row.candidateCount && !row.duplicateCount && <p className="text-sm text-slate-500 mt-2">Договор не найден. Уточните плательщика в чате.</p>}
        {!row.duplicateCount && row.candidates?.map((c: any) => <button type="button" key={c.contractId}
          className="block w-full text-left mt-2 rounded-xl p-3 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 text-sm"
          onClick={() => onPrepare(`Подготовь платёж с обязательным подтверждением: ${row.amount} рублей от ${row.date}, клиент ${c.customer}, договор ${c.product}. Идентификатор договора: ${c.contractId}. Это строка выписки, сначала проверь возможные дубли.`)}>
          Подготовить: {c.customer} — {c.product}
        </button>)}
      </div>)}
    </SheetSection>
  </GlassSheet>;
}
