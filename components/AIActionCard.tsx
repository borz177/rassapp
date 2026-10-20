import React, { useState } from 'react';
import { Check, Download, FileSpreadsheet, FileText, MessageCircle, Receipt, RotateCcw, Send, ShieldAlert, Trash2, Undo2 } from 'lucide-react';

/**
 * Карточки действий FinUchetGPT под ответом агента. Поведение (запросы,
 * сохранение договора, отправка PDF) — в AIAssistant.tsx, здесь только вид.
 *
 *  • choices       — варианты-кнопки к уточняющему вопросу;
 *  • confirm       — «Подтвердить»/«Отмена» (режим «Подтверждение»);
 *  • done          — уже выполнено (режим «Авто») — с «Отменить»;
 *  • contract_form — договор: черновик → форма, а в «Авто» — сразу оформлен;
 *  • send_doc      — PDF договора или чека клиенту в WhatsApp.
 */

export type SendState = 'busy' | 'done' | 'error';

export type AIAction =
  | { id: string; kind: 'choices'; title: string; options: { label: string; ref?: string }[]; state?: 'done'; chosen?: number }
  | { id: string; kind: 'confirm'; tool: string; title: string; summary: string; contractId?: string; overLimit?: number; always?: boolean; checkPhone?: string;
      /** Сумма прочитана с фото чека — сверить */
      fromPhoto?: boolean;
      state?: 'busy' | 'done' | 'error' | 'cancelled' | 'undoing' | 'undone'; result?: string; undoable?: boolean;
      undoResult?: string; receipt?: SendState; receiptResult?: string }
  | { id: string; kind: 'done'; tool: string; title: string; summary: string; contractId?: string; ok: boolean; result: string; undoable?: boolean;
      state?: 'undoing' | 'undone'; undoResult?: string; receipt?: SendState; receiptResult?: string }
  | { id: string; kind: 'contract_form'; title: string; draft: any; auto?: boolean; overLimit?: number; checkPhone?: string;
      state?: 'done' | 'saving' | 'saved' | 'failed' | 'deleting' | 'deleted';
      saved?: { saleId: string; customerId?: string; number?: string; total?: number; monthly?: number; offline?: boolean };
      result?: string; send?: SendState; sendResult?: string }
  | { id: string; kind: 'report'; title: string; summary: string; from: string | null; to: string | null; onlyActive?: boolean;
      /** Отчёт по одному инвестору или счёту */
      accountIds?: string[]; scopeLabel?: string;
      state?: 'busy' | 'done' | 'error'; result?: string }
  /** Удалить договор — по нажатию, всё делает приложение (handleDeleteSale) */
  | { id: string; kind: 'delete_contract'; title: string; summary: string; saleId: string; note?: string;
      state?: 'busy' | 'done' | 'error' | 'cancelled'; result?: string }
  /** Кнопка перехода в раздел приложения (например, подключить WhatsApp) */
  | { id: string; kind: 'open_view'; title: string; summary?: string; view: 'whatsapp' }
  | { id: string; kind: 'send_doc'; title: string; summary: string; doc: 'contract' | 'receipt'; saleId: string; auto?: boolean;
      state?: 'busy' | 'done' | 'error' | 'cancelled'; result?: string };

const fmt = (n: any) => (Number(n) ? `${Math.round(Number(n)).toLocaleString('ru-RU')} ₽` : '—');

const shell = 'ai-card-in rounded-3xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/70 dark:bg-violet-500/10 p-4';
const primary = 'flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-violet-600 text-white text-sm font-bold active:scale-[.98] transition disabled:opacity-60';
const secondary = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-semibold border border-slate-200 dark:border-slate-700 active:scale-[.98] transition disabled:opacity-60';
const okLine = 'mt-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400';
const errLine = 'mt-2 text-sm font-semibold text-rose-600 dark:text-rose-400';
const mutedLine = 'mt-2 text-sm text-slate-500';

interface Props {
  action: AIAction;
  /** Договор: счёт, с которого он оформится (агент не назвал — основной, как в форме) */
  accountName?: string;
  /** Варианты нажимаются только у последнего сообщения и пока агент не занят */
  choicesActive: boolean;
  sending: boolean;
  whatsappEnabled: boolean;
  onChoose: (index: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onSendReceipt: () => void;
  onOpenForm: () => void;
  /** Оформить сразу (договор выше порога «Авто» ждёт нажатия) */
  onSaveContract: () => void;
  onShowContract: () => void;
  onSendContract: () => void;
  onDeleteContract: () => void;
  onSendDoc: () => void;
  onDownloadReport: () => void;
  onCancelDoc: () => void;
  /** Удалить договор (карточка delete_contract) / отказаться */
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  /** Открыть раздел приложения (карточка open_view) */
  onOpenView: () => void;
}

/** Пояснение, почему в «Авто» всё же просят подтвердить */
const OverLimit: React.FC<{ limit: number; what?: string }> = ({ limit, what = 'Сумма' }) => (
  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 rounded-full px-2.5 py-1">
    <ShieldAlert size={13} /> {what} от {limit.toLocaleString('ru-RU')} ₽ — подтвердите (порог «Авто»)
  </p>
);

/** «Авто», а телефон пришёл голосом: расшифровка могла ошибиться в цифре — проверить до записи */
const FromPhoto: React.FC = () => (
  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 rounded-full px-2.5 py-1">
    <ShieldAlert size={13} /> Сумма с фото — сверьте с чеком
  </p>
);

const CheckPhone: React.FC<{ phone: string }> = ({ phone }) => (
  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 rounded-full px-2.5 py-1">
    <ShieldAlert size={13} /> Телефон из голосового — проверьте: <span className="tabular-nums">{phone}</span>
  </p>
);

/** Строка «Отправить чек» под выполненным платежом */
const ReceiptRow: React.FC<{ state?: SendState; result?: string; onSend: () => void }> = ({ state, result, onSend }) => (
  state === 'done' ? <p className={okLine}>✓ {result || 'Чек отправлен'}</p>
    : <>
        {state === 'error' && <p className={errLine}>{result}</p>}
        <button onClick={onSend} disabled={state === 'busy'} className={`${secondary} mt-2 w-full`}>
          <Receipt size={16} /> {state === 'busy' ? 'Отправляем чек…' : state === 'error' ? 'Отправить чек ещё раз' : 'Отправить чек в WhatsApp'}
        </button>
      </>
);

const AIActionCard: React.FC<Props> = (p) => {
  const { action: a } = p;
  // «Отменить» договор — со вторым нажатием: удаляется целый договор
  const [askDelete, setAskDelete] = useState(false);

  if (a.kind === 'choices') {
    return (
      <div className="flex flex-wrap gap-2">
        {a.options.map((o, i) => {
          const stale = a.state === 'done' || !p.choicesActive;
          const chosen = a.chosen === i;
          return (
            <button key={i} disabled={stale || p.sending} onClick={() => p.onChoose(i)} style={{ animationDelay: `${i * 50}ms` }}
                    className={`ai-msg-in px-3.5 py-2 rounded-2xl text-sm text-left border transition active:scale-[.97] ${chosen
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : stale
                        ? 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'
                        : 'bg-white dark:bg-slate-800 border-violet-300 dark:border-violet-500/40 text-violet-700 dark:text-violet-200 hover:bg-violet-50 dark:hover:bg-violet-500/10'}`}>
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  const title = <p className="text-xs font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">{a.title}</p>;

  if (a.kind === 'confirm' || a.kind === 'done') {
    const executed = a.kind === 'done' ? a.ok : a.state === 'done' || a.state === 'undoing';
    const undone = a.state === 'undone';
    const receiptFor = a.tool === 'create_payment' && a.contractId && p.whatsappEnabled;
    return (
      <div className={shell}>
        {title}
        <p className="mt-1 text-[15px] text-slate-800 dark:text-slate-100">{a.summary}</p>
        {a.kind === 'confirm' && !a.state && a.overLimit != null && <OverLimit limit={a.overLimit} />}
        {a.kind === 'confirm' && !a.state && a.checkPhone && <CheckPhone phone={a.checkPhone} />}
        {a.kind === 'confirm' && !a.state && a.fromPhoto && <FromPhoto />}
        {a.kind === 'confirm' && !a.state && a.always && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 rounded-full px-2.5 py-1">
            <ShieldAlert size={13} /> Рассылку всегда подтверждаете вы — отменить её нельзя
          </p>
        )}
        {a.kind === 'confirm' && !a.state && (
          <div className="mt-3 flex gap-2">
            <button onClick={p.onConfirm} className={primary}>Подтвердить</button>
            <button onClick={p.onCancel} className={secondary}>Отмена</button>
          </div>
        )}
        {a.kind === 'confirm' && a.state === 'busy' && (
          <div className="mt-3 flex gap-2"><button disabled className={primary}>Выполняем…</button></div>
        )}
        {a.kind === 'confirm' && a.state === 'cancelled' && <p className={mutedLine}>Отменено</p>}
        {((a.kind === 'confirm' && a.state === 'error') || (a.kind === 'done' && !a.ok)) && (
          <p className={errLine}>{a.result}</p>
        )}
        {undone && <p className={mutedLine}><RotateCcw size={13} className="inline -mt-0.5 mr-1" />{a.undoResult || 'Отменено'}</p>}
        {executed && !undone && (
          <>
            <p className={okLine}>✓ {a.result}</p>
            {a.undoResult && <p className={errLine}>{a.undoResult}</p>}
            {receiptFor && <ReceiptRow state={a.receipt} result={a.receiptResult} onSend={p.onSendReceipt} />}
            {a.undoable && (
              <button onClick={p.onUndo} disabled={a.state === 'undoing'} className={`${secondary} mt-2 w-full`}>
                <Undo2 size={16} /> {a.state === 'undoing' ? 'Отменяем…' : 'Отменить'}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  if (a.kind === 'report') {
    return (
      <div className={shell}>
        {title}
        <p className="mt-1 text-[15px] text-slate-800 dark:text-slate-100 flex items-start gap-2"><FileSpreadsheet size={18} className="mt-0.5 shrink-0 text-emerald-600" />{a.summary}</p>
        {a.state === 'done' && <p className={okLine}>✓ {a.result}</p>}
        {a.state === 'error' && <p className={errLine}>{a.result}</p>}
        <button onClick={p.onDownloadReport} disabled={a.state === 'busy'} className={`${primary} mt-3 w-full`}>
          <Download size={16} /> {a.state === 'busy' ? 'Собираем отчёт…' : a.state === 'done' ? 'Скачать ещё раз' : 'Скачать'}
        </button>
      </div>
    );
  }

  if (a.kind === 'delete_contract') {
    return (
      <div className="ai-card-in rounded-3xl border border-rose-200 dark:border-rose-500/30 bg-rose-50/70 dark:bg-rose-500/10 p-4">
        {title}
        <p className="mt-1 text-[15px] text-slate-800 dark:text-slate-100 flex items-start gap-2"><Trash2 size={18} className="mt-0.5 shrink-0 text-rose-500" />{a.summary}</p>
        {!a.state && <p className={mutedLine}>{a.note ? `${a.note} ` : ''}Удаление не отменить.</p>}
        {a.state === 'done' && <p className={okLine}>✓ {a.result}</p>}
        {a.state === 'cancelled' && <p className={mutedLine}>Не удалён</p>}
        {a.state === 'error' && <p className={errLine}>{a.result}</p>}
        {(!a.state || a.state === 'busy') && (
          <div className="mt-3 flex gap-2">
            <button onClick={p.onConfirmDelete} disabled={a.state === 'busy'}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-rose-600 text-white text-sm font-bold active:scale-[.98] transition disabled:opacity-60">
              <Trash2 size={16} /> {a.state === 'busy' ? 'Удаляем…' : 'Удалить'}
            </button>
            {!a.state && <button onClick={p.onCancelDelete} className={secondary}>Отмена</button>}
          </div>
        )}
      </div>
    );
  }

  if (a.kind === 'open_view') {
    return (
      <div className={shell}>
        {a.summary && <p className="text-sm text-slate-600 dark:text-slate-300 flex items-start gap-2"><MessageCircle size={18} className="mt-0.5 shrink-0 text-emerald-600" />{a.summary}</p>}
        <button onClick={p.onOpenView} className={`${primary} mt-3 w-full`}>{a.title}</button>
      </div>
    );
  }

  if (a.kind === 'send_doc') {
    const Icon = a.doc === 'receipt' ? Receipt : FileText;
    return (
      <div className={shell}>
        {title}
        <p className="mt-1 text-[15px] text-slate-800 dark:text-slate-100 flex items-start gap-2"><Icon size={18} className="mt-0.5 shrink-0 text-violet-500" />{a.summary}</p>
        {a.state === 'done' && <p className={okLine}>✓ {a.result}</p>}
        {a.state === 'cancelled' && <p className={mutedLine}>Не отправлено</p>}
        {a.state === 'error' && <p className={errLine}>{a.result}</p>}
        {(!a.state || a.state === 'error' || a.state === 'busy') && (
          <div className="mt-3 flex gap-2">
            <button onClick={p.onSendDoc} disabled={a.state === 'busy'} className={primary}>
              <Send size={16} /> {a.state === 'busy' ? 'Отправляем…' : a.state === 'error' ? 'Ещё раз' : 'Отправить'}
            </button>
            {!a.state && <button onClick={p.onCancelDoc} className={secondary}>Отмена</button>}
          </div>
        )}
      </div>
    );
  }

  // Договор
  const d = a.draft || {};
  const rows = (
    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <span className="text-slate-500">Клиент</span><span className="text-slate-800 dark:text-slate-100 text-right truncate">{d.newCustomer?.name || d.customerName || (d.customerId ? 'из базы' : '—')}</span>
      <span className="text-slate-500">Товар</span><span className="text-slate-800 dark:text-slate-100 text-right truncate">{d.productName || '—'}</span>
      <span className="text-slate-500">Закуп</span><span className="text-slate-800 dark:text-slate-100 text-right">{fmt(d.buyPrice)}</span>
      {a.saved?.total
        ? <><span className="text-slate-500">Цена</span><span className="text-slate-800 dark:text-slate-100 text-right">{fmt(a.saved.total)}</span></>
        : <><span className="text-slate-500">{d.totalPrice ? 'Цена' : 'Наценка'}</span><span className="text-slate-800 dark:text-slate-100 text-right">{d.totalPrice ? fmt(d.totalPrice) : d.markupPercent != null ? `${d.markupPercent}%` : '—'}</span></>}
      <span className="text-slate-500">Срок</span><span className="text-slate-800 dark:text-slate-100 text-right">{d.months ? `${d.months} мес.` : 'уточните в форме'}</span>
      {a.saved?.monthly ? <><span className="text-slate-500">Платёж</span><span className="text-slate-800 dark:text-slate-100 text-right">{fmt(a.saved.monthly)} / мес</span></> : null}
      <span className="text-slate-500">Взнос</span><span className="text-slate-800 dark:text-slate-100 text-right">{d.downPayment ? fmt(d.downPayment) : 'без взноса'}</span>
      {(d.accountName || p.accountName) && <><span className="text-slate-500">Счёт</span><span className="text-slate-800 dark:text-slate-100 text-right truncate">{d.accountName || p.accountName}</span></>}
    </div>
  );

  if (a.state === 'saving') {
    return (
      <div className={shell}>
        {title}
        {rows}
        <div className="mt-3 flex gap-2"><button disabled className={primary}>Оформляем договор…</button></div>
      </div>
    );
  }

  if (a.state === 'saved' || a.state === 'deleting') {
    const s = a.saved!;
    return (
      <div className={shell}>
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
          <Check size={14} strokeWidth={3} /> Договор {s.number ? `№${s.number} ` : ''}оформлен
        </p>
        {rows}
        {s.offline && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Нет связи — договор сохранён на устройстве и уйдёт на сервер, когда появится сеть.</p>}
        <div className="mt-3 flex gap-2">
          <button onClick={p.onShowContract} className={primary}>Открыть договор</button>
        </div>
        {p.whatsappEnabled && (
          a.send === 'done' ? <p className={okLine}>✓ {a.sendResult}</p>
            : <>
                {a.send === 'error' && <p className={errLine}>{a.sendResult}</p>}
                <button onClick={p.onSendContract} disabled={a.send === 'busy'} className={`${secondary} mt-2 w-full`}>
                  <Send size={16} /> {a.send === 'busy' ? 'Отправляем договор…' : a.send === 'error' ? 'Отправить ещё раз' : 'Отправить договор в WhatsApp'}
                </button>
              </>
        )}
        {askDelete ? (
          <div className="mt-2 rounded-2xl bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-500/30 p-3">
            <p className="text-sm text-slate-700 dark:text-slate-200">Удалить этот договор? Закуп вернётся на счёт.</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => { setAskDelete(false); p.onDeleteContract(); }} disabled={a.state === 'deleting'}
                      className="flex-1 py-2 rounded-xl bg-rose-500 text-white text-sm font-bold disabled:opacity-60">{a.state === 'deleting' ? 'Удаляем…' : 'Удалить'}</button>
              <button onClick={() => setAskDelete(false)} className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold">Оставить</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAskDelete(true)} disabled={a.state === 'deleting'} className={`${secondary} mt-2 w-full`}>
            <Undo2 size={16} /> {a.state === 'deleting' ? 'Отменяем…' : 'Отменить договор'}
          </button>
        )}
        {a.result && a.state === 'saved' && a.result !== 'Договор оформлен' && <p className={errLine}>{a.result}</p>}
      </div>
    );
  }

  if (a.state === 'deleted') {
    return (
      <div className={shell}>
        {title}
        <p className={mutedLine}><RotateCcw size={13} className="inline -mt-0.5 mr-1" />{a.result || 'Договор отменён и удалён.'}</p>
      </div>
    );
  }

  // Черновик: форма (режим «Подтверждение») или не получилось оформить сразу
  return (
    <div className={shell}>
      {title}
      {rows}
      {d.newCustomer?.passportNumber && (
        <p className="mt-2 text-xs text-slate-500">Паспорт {d.newCustomer.passportSeries} {d.newCustomer.passportNumber} — новый клиент будет заведён с этими данными</p>
      )}
      {a.state === 'failed' && <p className={errLine}>Сразу не оформил: {a.result}</p>}
      {(a.overLimit != null || a.checkPhone) && !a.state ? (
        <>
          {a.overLimit != null && <OverLimit limit={a.overLimit} what="Закуп" />}
          {a.checkPhone && <CheckPhone phone={a.checkPhone} />}
          <div className="mt-3 flex gap-2">
            <button onClick={p.onSaveContract} className={primary}>Оформить</button>
            <button onClick={p.onOpenForm} className={secondary}>Форма</button>
          </div>
        </>
      ) : (
        <button onClick={p.onOpenForm} className={`${primary} mt-3 w-full`}>
          {a.state === 'done' ? 'Открыть форму ещё раз' : 'Открыть форму договора'}
        </button>
      )}
    </div>
  );
};

export default AIActionCard;
