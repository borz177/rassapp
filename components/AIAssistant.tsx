import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import AIOrb from './AIOrb';
import Sheet from './Sheet';
import { SquarePen, Trash2, RotateCcw } from 'lucide-react';
import { api } from '../services/api';
import { startRecording, compressImage, MAX_RECORD_SECONDS, Recording } from '../src/aiMedia';
import { isIOSApp, publicOrigin } from '../src/platform';

/**
 * ИИ-ассистент: чат, голос и фото. Ответы и действия — server/ai/assistant.js.
 *
 * Всё, что меняет учёт, приходит карточкой: «Подтвердить» выполняет действие на
 * сервере, «Отмена» — забывает его. Договор ассистент не создаёт сам, а
 * открывает заполненную форму (onOpenContract) — человек проверяет и сохраняет.
 *
 * История разговора живёт на устройстве (localStorage, без фото и голоса) —
 * на сервере её нет.
 */

type Action =
  | { id: string; kind: 'choices'; title: string; options: { label: string; ref?: string }[]; state?: 'done'; chosen?: number }
  | { id: string; kind: 'confirm'; tool: string; title: string; summary: string; state?: 'done' | 'cancelled' | 'busy' | 'error'; result?: string }
  | { id: string; kind: 'contract_form'; title: string; draft: any; state?: 'done' };

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  image?: string;
  voice?: number; // длительность голосового, с
  note?: string; // для ассистента, не показывается: id варианта, выбранного кнопкой
  actions?: Action[];
  error?: boolean;
}

interface Props {
  userId: string;
  onBack: () => void;
  /** Черновик договора от ассистента → форма договора */
  onOpenContract: (draft: any) => void;
  /** После подтверждённого действия — подтянуть свежие данные */
  onDataChanged: () => void;
  onOpenTariffs: () => void;
}

/**
 * Пометка о черновике договора для истории: без неё «оформи на неё ещё один»
 * или «первому клиенту» модели не на что опереться — черновик ещё не сохранён,
 * клиента в базе нет. Модели id показывать можно, человеку она их не называет.
 */
const draftNote = (a: Action) => {
  if (a.kind !== 'contract_form') return '';
  const d = a.draft || {}, c = d.newCustomer;
  const who = c
    ? [c.name, c.birthDate && `д.р. ${c.birthDate}`, (c.passportSeries || c.passportNumber) && `паспорт ${c.passportSeries || ''} ${c.passportNumber || ''}`.trim(),
       c.passportIssuedBy && `выдан ${c.passportIssuedBy}`, c.passportIssueDate && `дата выдачи ${c.passportIssueDate}`, c.passportDivisionCode && `код ${c.passportDivisionCode}`,
       c.phone && `тел. ${c.phone}`, c.address && `адрес ${c.address}`].filter(Boolean).join(', ') + ' (новый клиент, в базе ещё нет)'
    : `клиент из базы ${d.customerId}`;
  return `[Черновик договора: ${d.productName || 'товар'}; ${who}]`;
};

/** Прошлые реплики для ассистента: последние 12; фото — пока они есть в памяти (после перезапуска не сохраняются) */
const toHistory = (messages: Msg[]) => messages
  .filter(m => !m.error && (m.text || m.image || m.actions?.length))
  .slice(-12)
  .map(m => ({
    role: m.role,
    text: [m.text + (m.note ? ` [${m.note}]` : ''), ...(m.actions || []).map(draftNote)].filter(Boolean).join('\n'),
    image: m.image && m.image.startsWith('data:image/') ? m.image : undefined,
  }));

const SUGGESTIONS = [
  'Кто должен больше всех?',
  'Какие платежи сегодня и завтра?',
  'Сколько я получил в этом месяце?',
  'Покажи просроченные договоры',
];

/** Текущий чат и прошлый — тот, что был до «Нового чата» (его можно вернуть) */
const storeKey = (userId: string, prev = false) => `finuchet_ai_chat_${userId}${prev ? '_prev' : ''}`;
const readStore = (userId: string, prev = false): Msg[] => {
  try { return JSON.parse(localStorage.getItem(storeKey(userId, prev)) || '[]'); } catch { return []; }
};
const writeStore = (userId: string, msgs: Msg[], prev = false) => {
  try {
    if (prev && !msgs.length) { localStorage.removeItem(storeKey(userId, true)); return; }
    // Без фото: они тяжёлые и это паспорта
    localStorage.setItem(storeKey(userId, prev), JSON.stringify(msgs.slice(-40).map(m => ({ ...m, image: m.image ? 'stripped' : undefined }))));
  } catch { /* место кончилось или приватный режим — история просто не сохранится */ }
};
const newId = () => `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Немного разметки из ответа модели: **жирный**, пункты «* » / «- » / «1. ».
 * Остальное — обычный текст (HTML не вставляем).
 */
const renderRich = (text: string): React.ReactNode => {
  const bold = (line: string, key: string) => line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : <React.Fragment key={`${key}-${i}`}>{part.replace(/\*\*/g, '')}</React.Fragment>);
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={`ul${out.length}`} className="my-1 space-y-1">{list}</ul>); list = []; } };
  lines.forEach((raw, i) => {
    const m = /^\s*(?:[*•-]|\d+[.)])\s+(.*)$/.exec(raw);
    if (m) { list.push(<li key={i} className="flex gap-2"><span className="text-violet-500 shrink-0">•</span><span>{bold(m[1], `l${i}`)}</span></li>); return; }
    flush();
    if (raw.trim()) out.push(<p key={i} className="my-0.5">{bold(raw, `p${i}`)}</p>);
  });
  flush();
  return out;
};

const fmt = (n: any) => (Number(n) ? `${Math.round(Number(n)).toLocaleString('ru-RU')} ₽` : '—');

const AIAssistant: React.FC<Props> = ({ userId, onBack, onOpenContract, onDataChanged, onOpenTariffs }) => {
  const [status, setStatus] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>(() => readStore(userId));
  const [prevChat, setPrevChat] = useState<Msg[]>(() => readStore(userId, true));
  const [clearOpen, setClearOpen] = useState(false);
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const listEnd = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadStatus = () => api.aiAssistant.status().then(s => { setStatus(s); if (!s.consent) setConsentOpen(true); }).catch(() => {});
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { writeStore(userId, messages); }, [messages, userId]);
  // Что листается: слой страницы PagePush, на Mac — карточка, иначе окно
  const scroller = (): HTMLElement | null => {
    let el: HTMLElement | null = listEnd.current?.parentElement || null;
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    return el;
  };
  const scrollToEnd = (smooth: boolean) => {
    const el = scroller();
    const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
  };
  // При открытии — сразу внизу, без анимации: плавная прокрутка во время
  // въезда страницы обрывалась, и длинный чат открывался посередине.
  // Новые сообщения — плавно.
  const opened = useRef(false);
  useLayoutEffect(() => {
    scrollToEnd(opened.current);
    opened.current = true;
  }, [messages.length, sending]);
  // Прилипание к низу: пока человек внизу, а лента подросла (догрузились
  // тариф в шапке, фото, карточка действия) — остаёмся внизу. Пролистал
  // вверх — не трогаем.
  const atBottom = useRef(true);
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const el = scroller();
    const target: HTMLElement | Window = el || window;
    const onScroll = () => {
      const top = el ? el.scrollTop : window.scrollY;
      const max = el ? el.scrollHeight - el.clientHeight : document.documentElement.scrollHeight - window.innerHeight;
      atBottom.current = max - top < 80;
    };
    const ro = new ResizeObserver(() => { if (atBottom.current) scrollToEnd(false); });
    ro.observe(root);
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => { ro.disconnect(); target.removeEventListener('scroll', onScroll); };
  }, []);

  // Поле ввода растёт вместе с текстом, до пяти строк
  useLayoutEffect(() => {
    const el = inputRef.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [text]);

  // Таймер и уровень звука во время записи
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    let raf = 0;
    const tick = () => {
      setLevel(recording.level());
      const s = (Date.now() - started) / 1000;
      setRecSeconds(s);
      if (s >= MAX_RECORD_SECONDS) { finishRecording(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const patchAction = (msgId: string, actionId: string, patch: Partial<Action>) =>
    setMessages(ms => ms.map(m => m.id !== msgId ? m : { ...m, actions: m.actions?.map(a => a.id === actionId ? { ...a, ...patch } as Action : a) }));

  const send = async (payload: { text?: string; image?: string | null; audio?: { data: string; format: string }; voice?: number; note?: string }) => {
    if (sending) return;
    if (status && !status.consent) { setConsentOpen(true); return; }
    const userMsg: Msg = { id: newId(), role: 'user', text: payload.text || '', image: payload.image || undefined, voice: payload.voice, note: payload.note };
    const history = toHistory(messages);
    setMessages(ms => [...ms, userMsg]);
    setText(''); setImage(null);
    setSending(true);
    try {
      const r = await api.aiAssistant.message({ text: [payload.text, payload.note && `[${payload.note}]`].filter(Boolean).join(' '), history, image: payload.image || undefined, audio: payload.audio });
      setMessages(ms => [...ms, { id: newId(), role: 'assistant', text: r.reply, actions: r.actions }]);
      setStatus((s: any) => s ? { ...s, left: r.left } : s);
    } catch (e: any) {
      if (e.code === 'AI_CONSENT_REQUIRED') setConsentOpen(true);
      setMessages(ms => [...ms, {
        id: newId(), role: 'assistant', error: true,
        text: e.code === 'AI_LIMIT' ? `${e.message} Подключите тариф ИИ, чтобы продолжить.` : e.message || 'Ассистент не ответил — попробуйте ещё раз.',
      }]);
      if (e.code === 'AI_LIMIT') loadStatus();
    } finally {
      setSending(false);
    }
  };

  const submit = () => {
    const t = text.trim();
    if (!t && !image) return;
    send({ text: t, image });
  };

  const toggleMic = async () => {
    setMicError(null);
    if (recording) { finishRecording(); return; }
    try {
      const r = await startRecording();
      setRecSeconds(0);
      setRecording(r);
    } catch (e: any) {
      setMicError(e?.name === 'NotAllowedError' ? 'Нет доступа к микрофону — разрешите его в настройках.' : e.message || 'Микрофон недоступен');
    }
  };
  const finishRecording = async () => {
    const r = recording; if (!r) return;
    setRecording(null);
    try {
      const audio = await r.stop();
      if (audio.seconds < 0.6) return; // случайное касание
      send({ audio: { data: audio.data, format: audio.format }, voice: Math.round(audio.seconds), image, text: text.trim() || undefined });
    } catch (e: any) { setMicError(e.message); }
  };
  const cancelRecording = () => { recording?.cancel(); setRecording(null); };

  const pickPhoto = async (f?: File | null) => {
    if (!f) return;
    try { setImage(await compressImage(f)); } catch (e: any) { setMicError(e.message); }
  };

  const confirm = async (msgId: string, a: Action) => {
    patchAction(msgId, a.id, { state: 'busy' });
    const r = await api.aiAssistant.confirm(a.id);
    patchAction(msgId, a.id, { state: r.ok ? 'done' : 'error', result: r.text });
    if (r.ok) onDataChanged();
  };
  const cancel = (msgId: string, a: Action) => {
    api.aiAssistant.cancel(a.id);
    patchAction(msgId, a.id, { state: 'cancelled' });
  };

  const acceptConsent = async () => {
    await api.aiAssistant.consent();
    setConsentOpen(false);
    loadStatus();
  };

  // Новый чат: текущий откладываем — его можно вернуть из пустого чата
  const newChat = () => {
    if (sending) return;
    writeStore(userId, messages, true);
    setPrevChat(messages);
    setMessages([]);
  };
  const restorePrev = () => {
    setMessages(prevChat);
    writeStore(userId, [], true);
    setPrevChat([]);
  };
  // Очистить: переписка удаляется с устройства насовсем
  const clearChat = () => {
    setMessages([]);
    setClearOpen(false);
  };
  const iosApp = isIOSApp();
  const empty = messages.length === 0;

  return (
    <div ref={rootRef} className="flex flex-col min-h-[calc(100dvh-9rem)] md:min-h-[calc(100dvh-6rem)] max-w-3xl mx-auto w-full">
      {/* Шапка */}
      {/* В пустом чате шар один — большой посередине; маленький в шапке появляется вместе с перепиской */}
      <div className="flex items-center gap-3 pb-3">
        {!empty && <AIOrb size={44} className="ai-msg-in" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">FinUchetGPT</h2>
          <button type="button" onClick={iosApp ? undefined : onOpenTariffs} className={`block text-left text-xs text-slate-500 dark:text-slate-400 ${iosApp ? 'cursor-default' : 'hover:text-violet-600 dark:hover:text-violet-300'}`}>
            {status ? (status.plan ? `${status.plan.name} · осталось ${status.left} из ${status.plan.monthly} в этом месяце` : `Пробный доступ · осталось ${status.left} запросов`) : 'Загружаем…'}
            {status && !iosApp && <span className="ml-1 font-semibold text-violet-600 dark:text-violet-300">· Тарифы ›</span>}
          </button>
        </div>
        {!empty && (
          <div className="ai-msg-in flex items-center gap-1 shrink-0">
            <button onClick={() => setClearOpen(true)} disabled={sending} aria-label="Очистить чат" title="Очистить чат"
                    className="w-10 h-10 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition disabled:opacity-40">
              <Trash2 size={20} />
            </button>
            <button onClick={newChat} disabled={sending} aria-label="Новый чат" title="Новый чат"
                    className="w-10 h-10 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition disabled:opacity-40">
              <SquarePen size={20} />
            </button>
          </div>
        )}
      </div>

      {/* Лента */}
      <div className="flex-1 space-y-3 pb-4">
        {empty && (
          <div className="ai-msg-in flex flex-col items-center text-center pt-6 pb-2">
            <AIOrb size={76} />
            <p className="mt-4 text-lg font-bold text-slate-900 dark:text-white">Чем помочь?</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
              Спросите про долги и платежи, попросите принять платёж или оформить договор. Можно голосом и с фото паспорта.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s, i) => (
                <button key={s} onClick={() => send({ text: s })} style={{ animationDelay: `${80 + i * 60}ms` }}
                        className="ai-msg-in px-3.5 py-2 rounded-2xl text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-violet-300 dark:hover:border-violet-500/50 active:scale-[.97] transition">
                  {s}
                </button>
              ))}
            </div>
            {prevChat.length > 0 && (
              <button onClick={restorePrev} style={{ animationDelay: '340ms' }}
                      className="ai-msg-in mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-violet-600 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition">
                <RotateCcw size={15} /> Вернуть прошлый чат
              </button>
            )}
          </div>
        )}

        {messages.map(m => (
          <div key={m.id} className={`ai-msg-in flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
            {m.role === 'assistant' && <AIOrb size={28} static className="mt-1" />}
            <div className={`max-w-[85%] space-y-2 ${m.role === 'user' ? 'items-end' : ''}`}>
              {(m.text || m.image || m.voice) && (
                <div className={`rounded-3xl px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere] ${
                  m.role === 'user'
                    ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-br-lg'
                    : m.error
                      ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 rounded-bl-lg'
                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700 rounded-bl-lg'}`}>
                  {m.image && m.image !== 'stripped' && <img src={m.image} alt="" className="mb-2 max-h-48 rounded-2xl" />}
                  {m.image === 'stripped' && <p className="text-xs opacity-75 mb-1">📷 Фото</p>}
                  {m.voice ? <p className="text-xs opacity-80 mb-0.5">🎙 Голосовое · {m.voice} с</p> : null}
                  {m.role === 'assistant' && !m.error ? renderRich(m.text) : m.text}
                  {m.error && /тариф ИИ/.test(m.text) && !iosApp && (
                    <button onClick={onOpenTariffs} className="block mt-2 text-sm font-bold underline">Тарифы ИИ</button>
                  )}
                </div>
              )}
              {m.actions?.map(a => a.kind === 'choices' ? (
                // Варианты ответа: нажатый уходит сообщением; после ответа (или если разговор ушёл дальше) — не нажимаются
                <div key={a.id} className="flex flex-wrap gap-2">
                  {a.options.map((o, i) => {
                    const stale = a.state === 'done' || m.id !== messages[messages.length - 1]?.id;
                    const chosen = a.chosen === i;
                    return (
                      <button key={i} disabled={stale || sending}
                              onClick={() => { patchAction(m.id, a.id, { state: 'done', chosen: i }); send({ text: o.label, note: o.ref }); }}
                              style={{ animationDelay: `${i * 50}ms` }}
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
              ) : (
                <div key={a.id} className="ai-card-in rounded-3xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/70 dark:bg-violet-500/10 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">{a.title}</p>
                  {a.kind === 'confirm' ? (
                    <>
                      <p className="mt-1 text-[15px] text-slate-800 dark:text-slate-100">{a.summary}</p>
                      {a.state === 'done' || a.state === 'error' ? (
                        <p className={`mt-2 text-sm font-semibold ${a.state === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{a.state === 'done' ? '✓ ' : ''}{a.result}</p>
                      ) : a.state === 'cancelled' ? (
                        <p className="mt-2 text-sm text-slate-500">Отменено</p>
                      ) : (
                        <div className="mt-3 flex gap-2">
                          <button disabled={a.state === 'busy'} onClick={() => confirm(m.id, a)}
                                  className="flex-1 py-2.5 rounded-2xl bg-violet-600 text-white text-sm font-bold active:scale-[.98] transition disabled:opacity-60">
                            {a.state === 'busy' ? 'Выполняем…' : 'Подтвердить'}
                          </button>
                          <button disabled={a.state === 'busy'} onClick={() => cancel(m.id, a)}
                                  className="px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-semibold border border-slate-200 dark:border-slate-700">
                            Отмена
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <span className="text-slate-500">Клиент</span><span className="text-slate-800 dark:text-slate-100 text-right truncate">{a.draft.newCustomer?.name || a.draft.customerName || (a.draft.customerId ? 'из базы' : '—')}</span>
                        <span className="text-slate-500">Товар</span><span className="text-slate-800 dark:text-slate-100 text-right truncate">{a.draft.productName || '—'}</span>
                        <span className="text-slate-500">Закуп</span><span className="text-slate-800 dark:text-slate-100 text-right">{fmt(a.draft.buyPrice)}</span>
                        <span className="text-slate-500">{a.draft.totalPrice ? 'Цена' : 'Наценка'}</span><span className="text-slate-800 dark:text-slate-100 text-right">{a.draft.totalPrice ? fmt(a.draft.totalPrice) : a.draft.markupPercent != null ? `${a.draft.markupPercent}%` : '—'}</span>
                        <span className="text-slate-500">Срок</span><span className="text-slate-800 dark:text-slate-100 text-right">{a.draft.months ? `${a.draft.months} мес.` : 'уточните в форме'}</span>
                        <span className="text-slate-500">Взнос</span><span className="text-slate-800 dark:text-slate-100 text-right">{a.draft.downPayment ? fmt(a.draft.downPayment) : 'без взноса'}</span>
                        {a.draft.accountName && <><span className="text-slate-500">Счёт</span><span className="text-slate-800 dark:text-slate-100 text-right truncate">{a.draft.accountName}</span></>}
                      </div>
                      {a.draft.newCustomer?.passportNumber && (
                        <p className="mt-2 text-xs text-slate-500">Паспорт {a.draft.newCustomer.passportSeries} {a.draft.newCustomer.passportNumber} — новый клиент будет заведён с этими данными</p>
                      )}
                      <button onClick={() => { onOpenContract(a.draft); patchAction(m.id, a.id, { state: 'done' }); }}
                              className="mt-3 w-full py-2.5 rounded-2xl bg-violet-600 text-white text-sm font-bold active:scale-[.98] transition">
                        {a.state === 'done' ? 'Открыть форму ещё раз' : 'Открыть форму договора'}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {sending && (
          <div className="ai-msg-in flex gap-2">
            <AIOrb size={28} className="mt-1" />
            <div className="rounded-3xl rounded-bl-lg bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 px-4 py-3 flex gap-1.5 items-center">
              <span className="ai-dot w-2 h-2 rounded-full bg-violet-500" />
              <span className="ai-dot w-2 h-2 rounded-full bg-violet-500" />
              <span className="ai-dot w-2 h-2 rounded-full bg-violet-500" />
            </div>
          </div>
        )}
        {/* Место под полем ввода: последнее сообщение не прячется за ним */}
        <div ref={listEnd} className="h-24" />
      </div>

      {/* Ввод */}
      {/* На телефоне поле ввода прижато к низу экрана (нижней панели здесь нет), на компьютере — к низу колонки */}
      <div className="fixed md:sticky left-4 right-4 md:left-auto md:right-auto bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:bottom-4 z-20">
        {micError && <p className="ai-msg-in mb-2 text-xs text-rose-600 dark:text-rose-400 text-center">{micError}</p>}
        {image && (
          <div className="ai-msg-in mb-2 inline-flex items-start gap-2 p-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <img src={image} alt="" className="h-16 rounded-xl" />
            <button onClick={() => setImage(null)} aria-label="Убрать фото" className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 text-sm leading-none">✕</button>
          </div>
        )}
        <div className="flex items-end gap-2 p-2 rounded-[28px] bg-white/90 dark:bg-slate-800/90 backdrop-blur border border-slate-200 dark:border-slate-700 shadow-lg">
          {recording ? (
            <>
              <button onClick={cancelRecording} aria-label="Отменить запись" className="w-11 h-11 shrink-0 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-lg">✕</button>
              <div className="flex-1 flex items-center gap-3 h-11 px-1">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                  {Math.floor(recSeconds / 60)}:{String(Math.floor(recSeconds % 60)).padStart(2, '0')}
                </span>
                <div className="flex-1 flex items-center gap-[3px] h-6 overflow-hidden">
                  {Array.from({ length: 24 }, (_, i) => (
                    <span key={i} className="w-[3px] rounded-full bg-violet-500 transition-all duration-100"
                          style={{ height: `${Math.max(12, Math.min(100, level * 100 * (0.5 + Math.abs(Math.sin(i * 1.7 + recSeconds * 6)) * 0.8)))}%` }} />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <button onClick={() => fileRef.current?.click()} aria-label="Фото" className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              <textarea ref={inputRef} value={text} onChange={e => setText(e.target.value)} rows={1}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); submit(); } }}
                        placeholder={image ? 'Что сделать?' : 'Спросите или попросите…'}
                        className="flex-1 resize-none bg-transparent outline-none py-2.5 text-[16px] text-slate-900 dark:text-white placeholder:text-slate-400 max-h-36" />
            </>
          )}
          {/* Микрофон — всегда, пока не набран текст: к фото можно сказать задание голосом */}
          {!text.trim() && (
            <button onClick={toggleMic} disabled={sending} aria-label={recording ? 'Отправить голосовое' : 'Сказать голосом'}
                    className={`relative w-11 h-11 shrink-0 rounded-full flex items-center justify-center active:scale-95 transition disabled:opacity-60 ${recording ? 'bg-rose-500 text-white shadow-md' : image ? 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700' : 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md'}`}>
              {recording && <span className="ai-mic-ring absolute inset-0 rounded-full bg-rose-400" />}
              {recording ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" /></svg>
              )}
            </button>
          )}
          {(text.trim() || image) && !recording && (
            <button onClick={submit} disabled={sending} aria-label="Отправить"
                    className="ai-msg-in w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-md active:scale-95 transition disabled:opacity-60">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          )}
        </div>
        {status && !status.plan && status.left <= 5 && !iosApp && (
          <button onClick={onOpenTariffs} className="mt-2 block mx-auto text-xs font-semibold text-violet-600 dark:text-violet-300">
            Пробных запросов осталось {status.left} · Тарифы ИИ
          </button>
        )}
      </div>

      {/* Согласие на передачу данных */}
      {clearOpen && (
        <Sheet onClose={() => setClearOpen(false)} className="sm:max-w-sm p-6">
          <div className="flex flex-col items-center text-center">
            <span className="w-12 h-12 rounded-full flex items-center justify-center bg-rose-50 dark:bg-rose-500/10 text-rose-500"><Trash2 size={22} /></span>
            <h3 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">Очистить чат?</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Переписка удалится с этого устройства, вернуть её не получится. Данные учёта не затронуты.</p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button onClick={() => setClearOpen(false)} className="py-3 rounded-2xl font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 active:scale-[.98] transition">Отмена</button>
            <button onClick={clearChat} className="py-3 rounded-2xl font-semibold bg-rose-500 text-white active:scale-[.98] transition">Очистить</button>
          </div>
        </Sheet>
      )}

      {consentOpen && (
        <Sheet onClose={() => setConsentOpen(false)} className="sm:max-w-md p-6">
          <div className="flex flex-col items-center text-center">
            <AIOrb size={56} />
            <h3 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">Перед началом</h3>
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            <p>Чтобы отвечать и выполнять поручения, ассистент передаёт текст запросов, голос, фото и нужные для ответа данные учёта (клиенты, договоры, платежи) провайдеру модели искусственного интеллекта через сервис OpenRouter. Обработка может проходить за пределами России.</p>
            <p>Данные используются только для ответа на ваш запрос. Действия с деньгами и записями выполняются, только когда вы нажмёте «Подтвердить».</p>
            <p>Если отправляете фото паспорта клиента — у вас должно быть его согласие на обработку персональных данных.</p>
          </div>
          <label className="mt-4 flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
            <input type="checkbox" checked={consentChecked} onChange={e => setConsentChecked(e.target.checked)} className="mt-0.5 w-5 h-5 accent-violet-600" />
            <span>Согласен на передачу и обработку данных, в том числе трансграничную, на условиях <a href={`${publicOrigin()}/privacy`} target="_blank" rel="noreferrer" className="text-violet-600 underline">политики обработки данных</a></span>
          </label>
          <div className="mt-5 flex gap-2">
            <button onClick={onBack} className="px-4 py-3 rounded-2xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700">Не сейчас</button>
            <button disabled={!consentChecked} onClick={acceptConsent} className="flex-1 py-3 rounded-2xl bg-violet-600 text-white text-sm font-bold disabled:opacity-50 transition">Начать</button>
          </div>
        </Sheet>
      )}
    </div>
  );
};

export default AIAssistant;
