import AIStatementPreview from './AIStatementPreview';
import AIAgentJournal from './AIAgentJournal';
import { toast } from '../src/toast';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AIOrb from './AIOrb';
import Sheet from './Sheet';
import { SquarePen, Trash2, RotateCcw, ShieldCheck, Zap, MoreHorizontal, Settings2, Plus, ChevronDown, Check, FileText } from 'lucide-react';
import AIAssistantSettings, { type AISettings } from './AIAssistantSettings';
import AIActionCard, { type AIAction } from './AIActionCard';
import { api } from '../services/api';
import { startRecording, compressImage, MAX_RECORD_SECONDS, Recording } from '../src/aiMedia';
import { isIOSApp, publicOrigin } from '../src/platform';
import { haptic } from './feedback';
import { animateScrollTop, KEYBOARD_MS, prefersReducedMotion } from '../src/easing';

/**
 * ИИ-агент: чат, голос и фото. Ответы и действия — server/ai/assistant.js.
 *
 * Режим выбирает человек (переключатель над полем ввода, запоминается):
 *  • «Подтверждение» — всё, что меняет учёт, приходит карточкой «Подтвердить»;
 *    договор — заполненной формой (onOpenContract);
 *  • «Авто» — платёж, расход, приход, клиент выполняются на сервере сразу,
 *    договор оформляется сразу (onCreateContract — тот же расчёт и сохранение,
 *    что у формы), документы уходят в WhatsApp сразу. У выполненного —
 *    «Отменить». Без обязательных полей договора агент спрашивает в любом
 *    режиме (server/ai/assistant.js).
 *
 * История разговора живёт на устройстве (localStorage, без фото и голоса) —
 * на сервере её нет.
 */

type Action = AIAction;
type Mode = 'confirm' | 'auto';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  image?: string;
  /** Несколько фото в сообщении (до трёх): паспорт клиента, поручителя… image — первое из них */
  images?: string[];
  aliceJobId?: string; // ответ с колонки, подтверждается только здесь
  voice?: number; // длительность голосового, с
  heard?: string; // расшифровка голосового (сервер) — видна под ним и уходит в историю
  note?: string; // для агента, не показывается: id варианта, выбранного кнопкой
  stopped?: boolean; // человек нажал «Стоп», ответа не было
  actions?: Action[];
  error?: boolean;
  workflow?: { id: string; status: string; step?: string; plan?: { title: string; status: string }[] };
}

interface Props {
  userId: string;
  onBack: () => void;
  /** Черновик договора от агента → форма договора */
  onOpenContract: (draft: any) => void;
  /** «Авто»: оформить договор сразу, без формы */
  onCreateContract: (draft: any) => Promise<{ ok: boolean; text: string; saleId?: string; customerId?: string; number?: string; monthly?: number; total?: number; offline?: boolean }>;
  /** PDF договора или чека клиенту в WhatsApp; fresh — сначала подтянуть данные (документ сразу после платежа) */
  onSendDocument: (saleId: string, kind: 'contract' | 'receipt', opts?: { fresh?: boolean }) => Promise<{ ok: boolean; text: string }>;
  /** «Отменить договор», оформленный в «Авто» */
  onDeleteContract: (saleId: string) => Promise<{ ok: boolean; text: string }>;
  /** Перенести дату первого платежа (карточка reschedule) — пересчёт графика как в форме договора */
  onReschedule?: (saleId: string, date: string) => Promise<{ ok: boolean; text: string }>;
  /** Карточка договора у клиента */
  onShowContract: (saleId: string, customerId?: string) => void;
  /** Отчёт Excel за период — собрать и сохранить (по нажатию «Скачать») */
  onExportReport: (opts: { from: string | null; to: string | null; onlyActive?: boolean; accountIds?: string[]; scopeLabel?: string }) => Promise<{ ok: boolean; text: string }>;
  whatsappEnabled: boolean;
  /** Счёт, на который ляжет договор: названный агентом или по умолчанию (как при оформлении) */
  contractAccountName?: (draft: any) => string;
  /** После подтверждённого действия — подтянуть свежие данные */
  onDataChanged: () => void;
  onOpenTariffs: () => void;
  /** Подключить WhatsApp — карточка под ответом «WhatsApp не подключён» */
  onOpenWhatsApp?: () => void;
  /** Шаблон договора из фото (карточка template_draft) → конструктор */
  onOpenTemplate?: (template: any, warnings?: string[]) => void;
}

/**
 * Пометки о действиях для истории: без них модель не знает, что черновик ещё
 * не сохранён («оформи на неё ещё один»), что платёж уже принят или отменён,
 * какой договор только что оформлен («отправь ему договор»). Модели id
 * показывать можно — человеку она их не называет.
 */
const actionNote = (a: Action): string => {
  if (a.kind === 'contract_form') {
    const d = a.draft || {}, c = d.newCustomer;
    if (a.state === 'saved' && a.saved) return `[Договор оформлен: ${a.saved.saleId}${a.saved.number ? ` (№${a.saved.number})` : ''}; ${d.productName || 'товар'}; клиент ${a.saved.customerId || d.customerId || c?.name || ''}]`;
    if (a.state === 'deleted') return `[Отменено: договор ${d.productName || ''} удалён]`;
    const who = c
      ? [c.name, c.birthDate && `д.р. ${c.birthDate}`, (c.passportSeries || c.passportNumber) && `паспорт ${c.passportSeries || ''} ${c.passportNumber || ''}`.trim(),
         c.passportIssuedBy && `выдан ${c.passportIssuedBy}`, c.passportIssueDate && `дата выдачи ${c.passportIssueDate}`, c.passportDivisionCode && `код ${c.passportDivisionCode}`,
         c.phone && `тел. ${c.phone}`, c.address && `адрес ${c.address}`].filter(Boolean).join(', ') + ' (новый клиент, в базе ещё нет)'
      : `клиент из базы ${d.customerId}`;
    return `[Черновик договора: ${d.productName || 'товар'}; ${who}]`;
  }
  if (a.kind === 'confirm') {
    if (a.state === 'undone') return `[Отменено: ${a.summary}]`;
    if (a.state === 'done' || a.state === 'undoing') return `[Выполнено: ${a.summary}]`;
    if (a.state === 'cancelled') return `[Отменено человеком, не выполнено: ${a.summary}]`;
    return `[Ждёт подтверждения: ${a.summary}]`;
  }
  if (a.kind === 'done') {
    if (!a.ok) return `[Не выполнено: ${a.result}]`;
    return a.state === 'undone' ? `[Отменено: ${a.summary}]` : `[Выполнено: ${a.summary}]`;
  }
  if (a.kind === 'reschedule') {
    if (a.state === 'done') return `[Выполнено: график перенесён — ${a.summary}]`;
    if (a.state === 'cancelled') return `[Отменено человеком, не перенесено: ${a.summary}]`;
    if (a.state === 'error') return `[Не выполнено: ${a.result}]`;
    return `[Ждёт подтверждения: перенести график — ${a.summary}]`;
  }
  if (a.kind === 'delete_contract') {
    if (a.state === 'done') return `[Выполнено: договор удалён — ${a.summary}]`;
    if (a.state === 'cancelled') return `[Отменено человеком, не удалён: ${a.summary}]`;
    if (a.state === 'error') return `[Не выполнено: ${a.result}]`;
    return `[Ждёт подтверждения: удалить договор — ${a.summary}]`;
  }
  if (a.kind === 'send_doc') {
    if (a.state === 'done') return `[Отправлено: ${a.title.toLowerCase()} — ${a.summary}]`;
    if (a.state === 'error') return `[Не отправлено: ${a.result}]`;
    return '';
  }
  return '';
};

/**
 * Прошлые реплики для агента: последние 12. Фото — пока они есть в памяти
 * (после перезапуска не сохраняются) и пока нужны: паспорт, по которому в
 * ответ сразу сделан черновик, больше не отправляем — его данные уже в пометке
 * черновика, а каждое фото — 1–2 тысячи токенов на каждом шаге разговора.
 */
/**
 * Режим агента в нижнем ряду панели — как выбор модели в ChatGPT: подпись
 * текущего режима, по нажатию — меню из двух вариантов с пояснением.
 */
const MODES = [
  { key: 'confirm', label: 'Подтверждать', hint: 'Каждое действие ждёт вашей кнопки', Icon: ShieldCheck, tone: 'text-violet-600 dark:text-violet-300' },
  { key: 'auto', label: 'Авто', hint: 'Делаю сразу, отменить можно 30 минут', Icon: Zap, tone: 'text-amber-500' },
] as const;
const ModeMenu: React.FC<{ mode: Mode; onChange: (m: Mode) => void }> = ({ mode, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const cur = MODES.find(m => m.key === mode) || MODES[0];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Режим агента: ${cur.label}`}
              className="h-10 inline-flex items-center gap-1.5 pl-2.5 pr-2 rounded-full text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-[.97] transition">
        <cur.Icon size={16} className={cur.tone} />
        {cur.label}
        <ChevronDown size={15} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="ai-pop absolute bottom-full right-0 mb-2 w-64 p-1.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl">
          {MODES.map(m => (
            <button key={m.key} role="menuitemradio" aria-checked={mode === m.key}
                    onClick={() => { setOpen(false); onChange(m.key); }}
                    className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50 dark:hover:bg-slate-700/60 transition">
              <m.Icon size={18} className={`mt-0.5 shrink-0 ${m.tone}`} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{m.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{m.hint}</span>
              </span>
              {mode === m.key && <Check size={16} className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-300" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const toHistory = (messages: Msg[]) => messages
  .filter(m => !m.error && (m.text || m.heard || m.image || m.actions?.length))
  .slice(-12)
  .map((m, i, list) => {
    const next = list[i + 1];
    const passportTaken = next?.role === 'assistant'
      && !!next.actions?.some(a => a.kind === 'contract_form' && a.draft?.newCustomer?.passportNumber);
    return {
      role: m.role,
      text: [[m.text, m.heard].filter(Boolean).join('\n') + (m.note ? ` [${m.note}]` : '') + (m.stopped ? ' [запрос остановлен человеком — не выполнять]' : ''), ...(m.actions || []).map(actionNote)].filter(Boolean).join('\n')
        + (m.image && passportTaken ? ' (было фото паспорта — данные в черновике договора)' : ''),
      image: m.image && m.image.startsWith('data:image/') && !passportTaken ? m.image : undefined,
    };
  });

/** Черновой текст во время печати — без служебных пометок, которые сервер всё равно уберёт в итоге */
const livePreview = (t: string) => t
  .replace(/\[(Черновик договора|Договор оформлен|Выполнено|Отменено|Отправлено|Не выполнено|Не отправлено|Ждёт подтверждения|Карточка|Кнопка)[^\]]*\]?/g, '')
  .replace(/\[(Отменить|Подтвердить|Отправить|Открыть форму договора|Открыть договор)\]/g, '');

// Первая — «Оформить договор», выделенная: так узнают, что агент оформляет договоры
// (по нажатию он спросит клиента, товар, закуп, наценку и срок)
const CONTRACT_SUGGESTION = { label: 'Оформить договор', text: 'Оформи договор' };
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
    if (prev && !msgs.length) { localStorage.removeItem(storeKey(userId, true)); return true; }
    // Без фото: они тяжёлые и это паспорта
    localStorage.setItem(storeKey(userId, prev), JSON.stringify(msgs.slice(-40).map(m => ({ ...m, image: m.image ? 'stripped' : undefined, images: undefined }))));
    return true;
  } catch { return false; /* Не подтверждаем доставку Алисы, пока история не сохранена. */ }
};
const newId = () => `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Режим запоминается на устройстве; про «Авто» один раз объясняем, что это значит
const modeKey = (userId: string) => `finuchet_ai_mode_${userId}`;
const autoAckKey = (userId: string) => `finuchet_ai_auto_ack_${userId}`;
const readMode = (userId: string): Mode => { try { return localStorage.getItem(modeKey(userId)) === 'auto' ? 'auto' : 'confirm'; } catch { return 'confirm'; } };

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


/**
 * Меню «⋯» в шапке чата: новый чат, очистить, настройки агента.
 * Раскрывается из угла, закрывается касанием мимо и Esc.
 */
const ChatMenu: React.FC<{ hasChat: boolean; busy: boolean; onNew: () => void; onClear: () => void; onSettings: () => void; onJournal: () => void; inTopbar?: boolean }> = ({ hasChat, busy, onNew, onClear, onSettings, onJournal, inTopbar }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const item = (label: string, Icon: React.ElementType, onClick: () => void, opts: { danger?: boolean; disabled?: boolean } = {}) => (
    <button role="menuitem" disabled={opts.disabled} onClick={() => { setOpen(false); onClick(); }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-[15px] text-left transition-colors disabled:opacity-40 ${opts.danger
              ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10'
              : 'text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700/60'}`}>
      <Icon size={18} className="shrink-0" /> {label}
    </button>
  );
  return (
    <div ref={ref} className="relative shrink-0 pointer-events-auto">
      <button onClick={() => setOpen(o => !o)} aria-label="Меню чата" aria-haspopup="menu" aria-expanded={open}
              className={inTopbar
                ? 'glass-surface rounded-full w-11 h-11 flex items-center justify-center text-slate-600 dark:text-slate-200 active:scale-95 transition-transform'
                : `w-10 h-10 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 active:scale-95 transition ${open ? 'bg-slate-200/70 dark:bg-slate-700' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
        <MoreHorizontal size={22} />
      </button>
      {open && (
        <div role="menu" className="ai-menu-in absolute right-0 top-12 z-30 w-60 py-1.5 rounded-2xl bg-white/95 dark:bg-slate-800/95 backdrop-blur border border-slate-200/80 dark:border-slate-700 shadow-xl">
          {item('Новый чат', SquarePen, onNew, { disabled: !hasChat || busy })}
          {item('Очистить чат', Trash2, onClear, { danger: true, disabled: !hasChat || busy })}
          <div className="my-1.5 h-px bg-slate-100 dark:bg-slate-700" />
          {item('Журнал действий', Settings2, onJournal)}
          {item('Настройки агента', Settings2, onSettings)}
        </div>
      )}
    </div>
  );
};

const AIAssistant: React.FC<Props> = ({ userId, onBack, onOpenContract, onCreateContract, onSendDocument, onDeleteContract, onShowContract, onExportReport, whatsappEnabled, onDataChanged, onOpenTariffs, contractAccountName, onOpenWhatsApp, onOpenTemplate, onReschedule }) => {
  const [status, setStatus] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>(() => readStore(userId));
  // Сообщения, что были при открытии, — без анимации появления: иначе вся
  // история разворачивалась заново и лента росла уже после прокрутки вниз
  const shownAtOpen = useRef<Set<string>>(new Set(messages.map(m => m.id)));
  const [prevChat, setPrevChat] = useState<Msg[]>(() => readStore(userId, true));
  const [clearOpen, setClearOpen] = useState(false);
  const [statementRows, setStatementRows] = useState<any[] | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Слот кнопок в верхней панели (Layout.tsx) — есть только в телефонной раскладке
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    setTopbarSlot(document.getElementById('topbar-actions-slot'));
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setPhone(!mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [mode, setModeState] = useState<Mode>(() => readMode(userId));
  const [autoIntro, setAutoIntro] = useState(false);
  const setMode = (m: Mode) => {
    if (m === 'auto') {
      let acked = false;
      try { acked = localStorage.getItem(autoAckKey(userId)) === '1'; } catch { /* приватный режим */ }
      if (!acked) { setAutoIntro(true); return; }
    }
    setModeState(m);
    try { localStorage.setItem(modeKey(userId), m); } catch { /* приватный режим — режим только до закрытия */ }
  };
  const acceptAuto = () => {
    try { localStorage.setItem(autoAckKey(userId), '1'); localStorage.setItem(modeKey(userId), 'auto'); } catch { /* см. выше */ }
    setModeState('auto');
    setAutoIntro(false);
  };
  const [text, setText] = useState('');
  // До трёх фото в сообщении («первый — клиент, второй — поручитель»); image — первое
  const [images, setImages] = useState<string[]>([]);
  const image = images[0] || null;
  const MAX_PHOTOS = 3;
  const [sending, setSending] = useState(false);
  // Идущий запрос — для «Стоп»; stopping — «Стоп» нажат, ждём безопасной точки
  const running = useRef<{ id: string; ctrl: AbortController; userMsgId: string } | null>(null);
  const [stopping, setStopping] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Что агент делает сейчас — приходит с сервера по шагам («Ищу клиента…»)
  const [stepLabel, setStepLabel] = useState('');
  // Ответ, пока он печатается (до итога с карточками)
  const [liveText, setLiveText] = useState('');
  useEffect(() => {
    if (!sending) { setElapsed(0); return; }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [sending]);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const listEnd = useRef<HTMLDivElement>(null);
  // Место под нижней панелью (режим, поле ввода, фото): на телефоне она висит
  // поверх ленты — ровно её высота (зазор даёт pb-4 ленты), а не отступ «с запасом»
  const composerRef = useRef<HTMLDivElement>(null);
  const [endSpace, setEndSpace] = useState(176);
  // Клавиатура телефона: окно приложения под неё не сжимается (Capacitor
  // Keyboard.resize: 'none', мобильные браузеры тоже), поэтому панель ввода
  // поднимаем сами — плавно, как в нативных чатах. Высоту клавиатуры знает
  // только visualViewport. lift — на сколько поднять панель: отступ под
  // «полоску» (safe-area) клавиатура и так закрывает, его вычитаем
  const [keyboard, setKeyboard] = useState(0);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  focusedRef.current = focused;
  // Запись голоса: поле уступает место записи и пропадает — blur от него может
  // не прийти, а клавиатура уже закрыта
  // Клавиатура при записи остаётся (как в Telegram): поле в фокусе, лишь спрятано под
  // полосой записи. Фокуса нет — значит, клавиатура закрыта
  useEffect(() => { if (recording && document.activeElement !== inputRef.current) setFocused(false); }, [recording]);
  const safeBottom = useRef(0);
  // Перепроверить высоту клавиатуры (см. ниже) — из фокуса поля
  const keyboardResync = useRef<() => void>(() => {});
  // Высота клавиатуры с прошлого раза (на этом устройстве, в этой ориентации):
  // по касанию поле сразу едет на неё — одним движением вместе с клавиатурой
  const kbKey = () => `finuchet_ai_kb_${window.innerWidth > window.innerHeight ? 'l' : 'p'}`;
  const predicted = useRef(0);
  const focusAt = useRef(0);
  // Подъём при касании (до фокуса) — см. onTouchStart у поля
  const preLifted = useRef(false);
  const touchY = useRef(0);
  const preLift = () => {
    let saved = 0;
    try { saved = Number(localStorage.getItem(kbKey())) || 0; } catch { /* без хранилища */ }
    if (saved <= 80) return;
    preLifted.current = true;
    setKeyboard(prev => (prev > 0 ? prev : saved));
    // Касание не стало фокусом (отпустили мимо, системный жест) — вернуть
    setTimeout(() => { if (preLifted.current && !focusedRef.current) { preLifted.current = false; setKeyboard(0); } }, 600);
  };
  const cancelPreLift = () => {
    if (!preLifted.current || focusedRef.current) return;
    preLifted.current = false;
    setKeyboard(0);
  };
  const predictKeyboard = () => {
    preLifted.current = false;
    focusAt.current = Date.now();
    let saved = 0;
    try { saved = Number(localStorage.getItem(kbKey())) || 0; } catch { /* без хранилища */ }
    predicted.current = saved > 80 ? saved : 0;
    if (predicted.current) setKeyboard(prev => (prev > 0 ? prev : predicted.current));
  };
  const lift = keyboard > 0 ? Math.max(0, keyboard - safeBottom.current) : 0;
  const liftRef = useRef(0);
  liftRef.current = lift;
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !phone) return;
    // Панель «качалась» вверх-вниз несколько секунд: в момент фокуса она ещё под
    // клавиатурой, iPhone сдвигает видимую область к курсору, мы считали высоту
    // С учётом сдвига (меньше), тут же сдвиг гасили (больше), панель ехала с
    // анимацией — и iPhone сдвигал снова. Теперь: высота — без сдвига (сразу
    // итоговая и не зависит от него), события одного кадра — одним обновлением,
    // мелочь (< 6 px) не трогает панель, а гасим сдвиг не чаще раза в 150 мс и не
    // больше трёх раз подряд — дальше не спорим с системой
    let frame = 0;
    let lastReset = 0, resets = 0;
    const apply = () => {
      frame = 0;
      if (focusedRef.current && (window.scrollY > 0 || vv.offsetTop > 0)) {
        const now = Date.now();
        if (now - lastReset > 1000) resets = 0;
        if (now - lastReset > 150 && resets < 3) { lastReset = now; resets++; window.scrollTo(0, 0); }
      }
      // От высоты макета, а не innerHeight: в Safari на iPhone innerHeight сам
      // сжимается до видимой области при открытой клавиатуре — разница выходила
      // нулевой, и панель оставалась под клавиатурой. Где окно под клавиатуру
      // сжимается целиком (Android), обе высоты меньше — и поднимать не нужно
      const layoutH = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const raw = Math.max(0, Math.round(layoutH - vv.height));
      // Меньше 80 px — не клавиатура (адресная строка, панель браузера)
      const k = raw > 80 ? raw : 0;
      // Пока клавиатура выезжает, iPhone присылает неполную высоту — поле
      // поднималось в два шага (рывок). Первые 650 мс после касания ниже
      // запомненной высоты не опускаем; дальше — как есть
      const opening = focusedRef.current && Date.now() - focusAt.current < 650;
      if (opening && k < predicted.current) return;
      setKeyboard(prev => (Math.abs(prev - k) < 6 && (prev > 0) === (k > 0) ? prev : k));
      // Устоявшаяся высота — запоминаем на устройстве (отдельно для ориентации)
      if (k > 0 && !opening) {
        predicted.current = k;
        try { localStorage.setItem(kbKey(), String(k)); } catch { /* без хранилища — без памяти */ }
      }
    };
    const sync = () => { if (!frame) frame = requestAnimationFrame(apply); };
    // Первое открытие клавиатуры в PWA на iPhone: высоту она сообщает, ещё не
    // выехав до конца (без строки подсказок), а финального события иногда нет —
    // панель вставала чуть ниже, «за» клавиатурой; во второй раз было верно.
    // После фокуса перепроверяем, когда клавиатура уже точно на месте
    keyboardResync.current = () => [120, 350, 700].forEach(t => setTimeout(sync, t));
    // Первое касание после входа на страницу: iPhone сам прокручивает всю
    // страницу на высоту клавиатуры (~100 мс), «показывая» поле, — запись с
    // телефона: scrollY 413 на 100–190 мс. Ждать кадра или 150 мс нельзя — это и
    // был рывок. Первые 700 мс после касания возвращаем сразу, в самом событии
    // (высота клавиатуры от прокрутки не зависит — «качелей» это не вернёт)
    const snapBack = () => {
      if (!focusedRef.current || Date.now() - focusAt.current > 700) return;
      if (window.scrollY > 0 || vv.offsetTop > 0) {
        window.scrollTo(0, 0);
      }
    };
    const onVv = () => { snapBack(); sync(); };
    // Вернулись в приложение (свернули и открыли): iPhone прятал клавиатуру, а
    // события об этом не приходило — поле оставалось поднятым над сообщениями.
    // Сверяемся заново, несколько раз: первые доли секунды размеры бывают старыми.
    // Поле не в фокусе — клавиатуры точно нет
    const resync = () => {
      if (document.visibilityState !== 'visible') return;
      if (document.activeElement !== inputRef.current) setKeyboard(0);
      else apply();
      measureRef.current();
      syncPpComp.current();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // Поле в фокусе — клавиатура сейчас вернётся (по записи — через ~0,1 с). Держим
      // поле на месте, как при открытии (первые 650 мс «пустой» размер не принимаем),
      // иначе оно опускалось и поднималось обратно. Не вернулась — опустится на 800 мс
      if (document.activeElement === inputRef.current) predictKeyboard();
      [0, 150, 400, 800].forEach(t => setTimeout(resync, t));
    };
    apply();
    vv.addEventListener('resize', onVv);
    vv.addEventListener('scroll', onVv);
    window.addEventListener('scroll', snapBack, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', onVv); vv.removeEventListener('scroll', onVv);
      window.removeEventListener('scroll', snapBack);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [phone]);
  useLayoutEffect(() => {
    const el = composerRef.current; if (!el) return;
    // Высота панели + её отступ от низа экрана — а не «высота окна минус верх
    // панели». Пока страница въезжает (PagePush: transform на слое), fixed-панель
    // считается от слоя и прокручивается вместе с лентой: после прокрутки к концу
    // её верх уходил далеко вверх, и под лентой появлялись тысячи пикселей
    // пустоты — лента «уезжала вверх» при открытии и при каждой отправке
    const measure = () => {
      if (!el.isConnected) return;
      const cs = getComputedStyle(el);
      const bottom = parseFloat(cs.bottom) || 0;
      safeBottom.current = Math.max(0, bottom - 12); // bottom = 0.75rem + safe-area
      setEndSpace(cs.position === 'fixed' ? Math.max(0, Math.round(el.offsetHeight + bottom + liftRef.current)) : 0);
    };
    measure();
    measureRef.current = measure;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  // Нижний отступ (полоска «Домой») мог прочитаться до того, как страница встала
  // на место, — перемеряем при фокусе вместе с высотой клавиатуры
  const measureRef = useRef<() => void>(() => {});
  // Клавиатура открылась/закрылась: место под лентой меняется вместе с панелью,
  // а последнее сообщение остаётся над ней (если человек был внизу). Доматываем
  // ленту только на открытии/закрытии — не на каждой подвижке высоты
  // Как в нативных чатах: лента едет вместе с полем — той же кривой и с той же
  // длительностью (src/easing.ts), а не браузерной прокруткой со своей скоростью.
  // На закрытии место под лентой убираем после движения: иначе браузер сразу
  // прижимал прокрутку, и лента прыгала вниз раньше, чем опускалось поле
  const wasLifted = useRef(false);
  const lastLift = useRef(0);
  const stopFeedAnim = useRef<() => void>(() => {});
  const shrinkTimer = useRef(0);
  // Пока лента едет вслед за клавиатурой, мгновенное «прилипание к низу» не мешает
  const feedAnimUntil = useRef(0);
  useLayoutEffect(() => {
    const el = composerRef.current; if (!el) return;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') return;
    const space = Math.max(0, Math.round(el.offsetHeight + (parseFloat(cs.bottom) || 0) + lift));
    const lifted = lift > 0;
    const prevLift = lastLift.current;
    lastLift.current = lift;
    const opened = lifted && !wasLifted.current;
    const closed = !lifted && wasLifted.current;
    wasLifted.current = lifted;
    const feed = scroller();
    window.clearTimeout(shrinkTimer.current);
    if (opened || closed) feedAnimUntil.current = Date.now() + KEYBOARD_MS + 80;
    // Лента едет вместе с полем CSS-сдвигом (feedRef) — на видеочипе, как само
    // поле; покадровая прокрутка на iPhone пропускала кадры, пока выезжает клавиатура
    // Слой ищем по стилю (overflow auto), а не по «есть что листать»: в коротком
    // чате до клавиатуры листать нечего — слой не находился, и подъём не шёл
    const list = feedRef.current;
    const layer = feedLayer();
    // Закрытие: прокрутку и место под лентой не трогаем, пока лента едет вниз, —
    // иначе iPhone, убирая клавиатуру, возвращал прокрутку слоя к прежней (по
    // записи: 452 → 831), и последние сообщения на долю секунды уходили вверх.
    // Лента опускается CSS-сдвигом вместе с полем; в конце в одном кадре сдвиг
    // меняем на прокрутку — картинка та же, скачка нет
    if (closed && layer && list && atBottom.current && !emptyRef.current) {
      const from = layer.scrollTop;
      slideDown(list, prevLift, () => {
        if (listEnd.current) listEnd.current.style.height = `${space}px`;
        setEndSpace(space);
        layer.scrollTop = Math.max(0, from - prevLift);
      });
      return;
    }
    if (opened && layer && list && atBottom.current && !emptyRef.current) {
      const from = layer.scrollTop;
      if (listEnd.current) listEnd.current.style.height = `${space}px`;
      setEndSpace(space);
      layer.scrollTop = opened ? layer.scrollHeight : Math.max(0, from - prevLift);
      slideFeed(list, layer.scrollTop - from);
      return;
    }
    if (closed && feed && atBottom.current && !emptyRef.current) {
      stopFeedAnim.current();
      stopFeedAnim.current = animateScrollTop(feed, feed.scrollTop - prevLift);
      shrinkTimer.current = window.setTimeout(() => setEndSpace(space), KEYBOARD_MS + 20);
      return;
    }
    setEndSpace(space);
    if (opened && atBottom.current) {
      requestAnimationFrame(() => {
        const f = scroller();
        stopFeedAnim.current();
        if (f && !emptyRef.current) stopFeedAnim.current = animateScrollTop(f, f.scrollHeight);
        else scrollToEnd(false);
      });
    }
  }, [lift]);
  // Лента едет вместе с полем ввода: CSS-сдвиг той же кривой и длительности, что у поля
  const feedRef = useRef<HTMLDivElement>(null);
  const slideFeed = (list: HTMLElement, shift: number) => {
    stopFeedAnim.current();
    if (Math.abs(shift) < 2 || prefersReducedMotion()) return;
    list.style.transition = 'none';
    list.style.transform = `translate3d(0, ${shift}px, 0)`;
    list.getBoundingClientRect();
    list.style.transition = `transform ${KEYBOARD_MS}ms cubic-bezier(.38, .7, .125, 1)`;
    list.style.transform = 'translate3d(0, 0, 0)';
    const clear = () => { list.style.transition = ''; list.style.transform = ''; };
    const t = window.setTimeout(() => { clear(); }, KEYBOARD_MS + 40);
    stopFeedAnim.current = () => { window.clearTimeout(t); clear(); };
  };
  // Прокручиваемый слой ленты — по стилю, даже когда листать пока нечего
  const feedLayer = (): HTMLElement | null => {
    let el: HTMLElement | null = listEnd.current?.parentElement || null;
    while (el && !/auto|scroll/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    return el;
  };
  // Опустить ленту на d по кривой клавиатуры, затем done() — в том же кадре, что и снятие сдвига
  const slideDown = (list: HTMLElement, d: number, done: () => void) => {
    stopFeedAnim.current();
    let finished = false;
    let t = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(t);
      list.style.transition = 'none';
      list.style.transform = '';
      done();
    };
    if (prefersReducedMotion()) { finish(); return; }
    list.style.transition = `transform ${KEYBOARD_MS}ms cubic-bezier(.38, .7, .125, 1)`;
    list.style.transform = `translate3d(0, ${d}px, 0)`;
    t = window.setTimeout(() => { finish(); }, KEYBOARD_MS + 20);
    // Палец на ленте — сразу в конечное положение
    stopFeedAnim.current = () => { finish(); };
  };
  // Поле у низа экрана, пока страница въезжает или уезжает свайпом. Тогда у слоя
  // PagePush стоит transform, и «fixed»-поле считается не от экрана, а от слоя —
  // и едет вместе с его прокруткой: чат открыт внизу, и поле на долю секунды
  // оказывалось посреди экрана, а потом падало вниз. Пока сдвиг есть, опускаем
  // поле на прокрутку слоя; сдвиг снят — поправку убираем в том же кадре, без анимации
  useLayoutEffect(() => {
    const comp = composerRef.current;
    if (!phone || !comp) return;
    let layer: HTMLElement | null = comp.parentElement;
    while (layer && !/auto|scroll/.test(getComputedStyle(layer).overflowY)) layer = layer.parentElement;
    if (!layer) return;
    const L = layer;
    let last = 0;
    // Въезд идёт, пока у слоя есть фактический сдвиг: PagePush снимает transform со
    // стиля на ~35-й мс, а дальше слой доезжает CSS-переходом ещё ~270 мс (по записи:
    // стиль пуст, а сдвиг 440 → 0). Смотреть только на стиль — поправка снималась
    // посреди въезда, и поле улетало в центр. Пока переход идёт — следим по кадрам
    let watchRaf = 0;
    const watch = () => {
      watchRaf = 0;
      if (getComputedStyle(L).transform !== 'none') watchRaf = requestAnimationFrame(watch);
      else update();
    };
    const update = () => {
      const styled = !!(L.style.transform || L.style.willChange);
      const moving = styled || getComputedStyle(L).transform !== 'none';
      if (moving && !styled && !watchRaf) watchRaf = requestAnimationFrame(watch);
      const off = moving ? Math.round(L.scrollTop) : 0;
      if (off === last) return;
      last = off;
      comp.style.transition = 'none';
      comp.style.setProperty('--pp-comp', `${off}px`);
      comp.getBoundingClientRect();
      // Сдвига больше нет — обычная плавность поля снова включена
      if (!moving) requestAnimationFrame(() => { comp.style.transition = ''; });
    };
    update();
    // Чат прокручивается к последним сообщениям в другом эффекте — пересчитываем
    // ещё раз перед первой отрисовкой (rAF из эффекта — до неё)
    const raf = requestAnimationFrame(update);
    syncPpComp.current = update;
    const mo = new MutationObserver(update);
    mo.observe(L, { attributes: true, attributeFilter: ['style'] });
    L.addEventListener('scroll', update, { passive: true });
    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(watchRaf); mo.disconnect(); L.removeEventListener('scroll', update); comp.style.removeProperty('--pp-comp'); comp.style.transition = ''; syncPpComp.current = () => {}; };
  }, [phone]);
  const syncPpComp = useRef<() => void>(() => {});
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadStatus = () => api.aiAssistant.status().then(s => {
    setStatus(s);
    if (!s.consent) setConsentOpen(true);
    showDigest(s.digest);
    showTips(s.proactive);
  }).catch(() => {});

  // Кнопки под сводкой — по её цифрам: нет просрочки — нет «Кто просрочил?».
  // Старая сводка без цифр — прежние три кнопки
  const digestOptions = (st?: { dueCount: number; overdueCount: number; remindable: number; muted: number }) => {
    if (!st) return [{ label: 'Кто просрочил?' }, { label: 'Какие платежи сегодня?' }, { label: 'Напомни всем должникам' }];
    const opts: { label: string }[] = [];
    if (st.overdueCount) opts.push({ label: `Кто просрочил? (${st.overdueCount})` });
    if (st.dueCount) opts.push({ label: `Какие платежи сегодня? (${st.dueCount})` });
    if (st.remindable) opts.push({ label: `Напомни всем должникам (${st.remindable})` });
    opts.push({ label: 'Сколько получено за неделю?' });
    return opts;
  };
  // Утренняя сводка (server/ai/digest.js) — один раз за день сообщением в чате,
  // с кнопками самых частых следующих шагов
  const showDigest = (digest?: { date: string; text: string; stats?: { dueCount: number; overdueCount: number; remindable: number; muted: number } } | null) => {
    if (!digest) return;
    const key = `finuchet_ai_digest_seen_${userId}`;
    try { if (localStorage.getItem(key) === digest.date) return; localStorage.setItem(key, digest.date); } catch { /* приватный режим */ }
    setMessages(ms => [...ms, {
      id: `digest_${newId()}`, role: 'assistant', text: `☀️ **План на сегодня**\n${digest.text.replace(/ — спросите FinUchetGPT.*$/, '.')}`,
      actions: [{ id: newId(), kind: 'choices', title: 'Что дальше?', options: digestOptions(digest.stats) }],
    }]);
  };
  // Подсказки агента (server/ai/proactive.js) — раз в день после сводки; кнопка
  // отправляет агенту готовую просьбу
  const showTips = (tips?: { date: string; text: string; options?: { label: string }[] } | null) => {
    if (!tips || !tips.options?.length) return;
    const key = `finuchet_ai_tips_seen_${userId}`;
    try { if (localStorage.getItem(key) === tips.date) return; localStorage.setItem(key, tips.date); } catch { /* приватный режим */ }
    setMessages(ms => [...ms, {
      id: `tips_${newId()}`, role: 'assistant', text: `💡 **Что можно сделать сегодня**\n${tips.text}`,
      actions: [{ id: newId(), kind: 'choices', title: 'С чего начнём?', options: tips.options!.map(o => ({ label: o.label })) }],
    }]);
  };
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => {
    if (writeStore(userId, messages)) {
      const ids = messages.filter(m => m.aliceJobId).map(m => m.aliceJobId!).slice(-10);
      if (ids.length) api.aiAssistant.acknowledgeAlice(ids).catch(() => {});
    }
  }, [messages, userId]);
  useEffect(() => {
    if (!status?.allowedRole || !status?.aliceEnabled || status?.sharedHistory) return;
    let alive = true;
    let busy = false;
    const receive = async () => {
      if (busy) return;
      busy = true;
      try {
        const { messages: inbox } = await api.aiAssistant.aliceInbox();
        if (!alive || !inbox.length) return;
        // Сервер может повторно доставить ответ при обрыве ACK. ID сообщений стабильны.
        const stored = new Set(readStore(userId).map(m => m.id));
        const delivered = inbox.filter(j => stored.has(`alice_a_${j.id}`)).map(j => j.id);
        if (delivered.length) await api.aiAssistant.acknowledgeAlice(delivered).catch(() => {});
        if (!alive) return;
        setMessages(current => {
          const ids = new Set(current.map(m => m.id));
          const incoming: Msg[] = [];
          for (const job of inbox) {
            if (ids.has(`alice_a_${job.id}`)) continue;
            incoming.push({ id: `alice_u_${job.id}`, role: 'user', text: `Алиса: ${job.question}`, note: 'Запрос с колонки Алиса' });
            incoming.push({ id: `alice_a_${job.id}`, aliceJobId: job.id, role: 'assistant',
              text: job.reply + (job.expired ? '\nПодтверждение устарело — попросите агента подготовить действие заново.' : ''),
              actions: job.actions.map(a => ({ ...a, auto: false })),
            });
          }
          return incoming.length ? [...current, ...incoming] : current;
        });
      } catch { /* Алиса необязательна; чат работает и без этого канала. */ }
      finally { busy = false; }
    };
    void receive();
    const timer = setInterval(receive, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [userId, status?.allowedRole, status?.aliceEnabled, status?.sharedHistory]);
  const sharedThread = useRef<string | null>((() => { try { return localStorage.getItem(`finuchet_ai_thread_${userId}`); } catch { return null; } })());
  useEffect(() => {
    if (!status?.sharedHistory || !status?.allowedRole || sending) return;
    let alive = true;
    let busy = false;
    const receive = async () => {
      if (busy || running.current) return;
      busy = true;
      try {
        const remote = await api.aiAssistant.history();
        if (!alive || running.current) return;
        const changedThread = sharedThread.current !== null && sharedThread.current !== remote.threadId;
        sharedThread.current = remote.threadId;
        try { localStorage.setItem(`finuchet_ai_thread_${userId}`, remote.threadId); } catch { /* без хранилища */ }
        setMessages(current => {
          const byId = new Map<string, Msg>(current.map(m => [m.id,m]));
          const synced: Msg[] = remote.messages.map(m => {
            const local = changedThread ? undefined : byId.get(m.id);
            return { ...local, ...m, image: local?.image, images: local?.images,
              actions: m.actions?.map((a: Action) => {
                const old = local?.actions?.find(x => x.id === a.id);
                return old && !['confirm','done','contract_form','send_doc','delete_contract','reschedule'].includes(a.kind) ? { ...a, ...old } : a;
              }) };
          });
          const ids = new Set(synced.map(m => m.id));
          const localOnly = changedThread ? [] : current.filter(m => !ids.has(m.id) && !m.id.startsWith('reply_') && !m.id.startsWith('alice_'));
          // Сводка и подсказки дня есть только здесь, на сервере их нет — после истории, а не над ней
          const ofDay = (m: Msg) => m.id.startsWith('digest_') || m.id.startsWith('tips_');
          return [...localOnly.filter(m => !ofDay(m)), ...synced, ...localOnly.filter(ofDay)];
        });
      } catch { /* Локальная история остаётся доступной без сети. */ }
      finally { busy = false; }
    };
    void receive();
    const timer = setInterval(receive, 8000);
    return () => { alive = false; clearInterval(timer); };
  }, [userId, status?.sharedHistory, status?.allowedRole, sending]);

  // Что листается: слой страницы PagePush, на Mac — карточка, иначе окно
  const scroller = (): HTMLElement | null => {
    let el: HTMLElement | null = listEnd.current?.parentElement || null;
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    return el;
  };
  // Пустой чат (приветствие и подсказки) — держим вверху: прокрутка «к концу»
  // на невысоком экране телефона уводила заголовок и тариф под верхнюю панель
  const emptyRef = useRef(true);
  const shortScreen = useMemo(() => typeof window !== 'undefined' && window.innerHeight < 720, []);
  emptyRef.current = !messages.length && !sending;
  const scrollToEnd = (smooth: boolean) => {
    const el = scroller();
    const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
    const top = emptyRef.current ? 0 : el ? el.scrollHeight : document.documentElement.scrollHeight;
    if (el) el.scrollTo({ top, behavior });
    else window.scrollTo({ top, behavior });
  };
  // При открытии — сразу внизу, без анимации: плавная прокрутка во время
  // въезда страницы обрывалась, и длинный чат открывался посередине.
  // Новые сообщения — плавно.
  const opened = useRef(false);
  useLayoutEffect(() => {
    scrollToEnd(opened.current);
    opened.current = true;
    // Страница ещё въезжает — поле должно остаться у низа и после этой прокрутки
    syncPpComp.current();
  }, [messages.length, sending]);
  // Прилипание к низу: пока человек внизу, а лента подросла (догрузились
  // тариф в шапке, фото, карточка действия) — остаёмся внизу. Пролистал
  // вверх — не трогаем.
  const atBottom = useRef(true);
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const el = scroller();
    const target: HTMLElement | Window = el || window;
    // Отлипаем от низа только по прокрутке человека (палец, колесо, клавиши):
    // свою прокрутку, догоняющую выросшую ленту, раньше принимали за «пролистал
    // вверх» — и длинный чат с карточками открывался посередине
    let userAt = 0;
    // Касание поля ввода и кнопок панели — не прокрутка ленты. Раньше и оно
    // считалось касанием ленты, и её собственная плавная прокрутка вслед за
    // клавиатурой принималась за «пролистал вверх»: после нескольких открытий
    // лента переставала ехать вместе с полем
    const touched = (e: Event) => {
      if (composerRef.current?.contains(e.target as Node)) return;
      userAt = Date.now();
      // Человек сам повёл ленту — наше движение уступает ему
      stopFeedAnim.current();
      feedAnimUntil.current = 0;
    };
    const onScroll = () => {
      if (Date.now() - userAt > 1000) return;
      // Ленту двигаем мы (вслед за клавиатурой) — это не прокрутка человека
      if (Date.now() < feedAnimUntil.current) return;
      const top = el ? el.scrollTop : window.scrollY;
      const max = el ? el.scrollHeight - el.clientHeight : document.documentElement.scrollHeight - window.innerHeight;
      atBottom.current = max - top < 80;
    };
    const ro = new ResizeObserver(() => { if (atBottom.current && Date.now() > feedAnimUntil.current) scrollToEnd(false); });
    ro.observe(root);
    target.addEventListener('scroll', onScroll, { passive: true });
    const intent = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;
    intent.forEach(ev => target.addEventListener(ev, touched, { passive: true }));
    return () => {
      ro.disconnect();
      target.removeEventListener('scroll', onScroll);
      intent.forEach(ev => target.removeEventListener(ev, touched));
    };
  }, []);

  // Поле ввода растёт вместе с текстом, до пяти строк
  useLayoutEffect(() => {
    const el = inputRef.current; if (!el) return;
    // Замер без анимации, затем переход от прежней высоты к новой
    const from = el.style.height;
    el.style.transition = 'none';
    el.style.height = 'auto';
    const to = `${Math.min(140, el.scrollHeight)}px`;
    el.style.height = from || to;
    void el.offsetHeight;
    el.style.transition = '';
    el.style.height = to;
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

  const send = async (payload: { text?: string; image?: string | null; images?: string[]; audio?: { data: string; format: string }; voice?: number; note?: string; forceConfirm?: boolean }) => {
    if (sending) return;
    if (status && !status.consent) { setConsentOpen(true); return; }
    const sentImages = payload.images?.length ? payload.images : payload.image ? [payload.image] : [];
    const userMsg: Msg = { id: newId(), role: 'user', text: payload.text || '', image: sentImages[0], images: sentImages.length > 1 ? sentImages : undefined, voice: payload.voice, note: payload.note };
    const history = toHistory(messages);
    setMessages(ms => [...ms, userMsg]);
    setText(''); setImages([]);
    setSending(true);
    const req = { id: userMsg.id, ctrl: new AbortController(), userMsgId: userMsg.id };
    running.current = req;
    setStepLabel('');
    setLiveText('');
    try {
      const r = await api.aiAssistant.message({
        text: [payload.text, payload.note && `[${payload.note}]`].filter(Boolean).join(' '),
        history, sharedHistory: !!status?.sharedHistory, image: sentImages[0], images: sentImages.length > 1 ? sentImages : undefined, audio: payload.audio, mode: payload.forceConfirm ? 'confirm' : mode, requestId: req.id,
      }, req.ctrl.signal,
        label => { if (running.current === req) setStepLabel(label); },
        piece => { if (running.current === req) setLiveText(t => piece === null ? '' : t + piece); });
      setStatus((s: any) => s ? { ...s, left: r.left } : s);
      if (typeof r.heard === 'string' && r.heard) setMessages(ms => ms.map(m => m.id === userMsg.id ? { ...m, heard: r.heard } : m));
      let actions: Action[] = r.actions || [];
      if (r.cancelled) {
        // Остановили: сделанное сервером показываем (с «Отменить»), а то, что
        // приложение сделало бы само (договор, отправка), — только кнопками
        actions = actions.map(a => (a.kind === 'contract_form' || a.kind === 'send_doc') ? { ...a, auto: false } : a);
        if (!actions.length) { markStopped(userMsg.id); return; }
      }
      const msgId = `reply_${userMsg.id}`;
      setMessages(ms => [...ms, { id: msgId, role: 'assistant', text: r.reply || (r.cancelled ? 'Остановлено.' : ''), actions }]);
      if (actions.some(a => a.kind === 'done' && a.ok)) onDataChanged();
      if (!r.cancelled) runAuto(msgId, actions);
    } catch (e: any) {
      if (req.ctrl.signal.aborted) {
        // Сервер не ответил на «Стоп» вовремя — оборвали сами. Что-то могло
        // успеть записаться: данные подтягиваем
        markStopped(userMsg.id);
        onDataChanged();
        return;
      }
      if (e.code === 'AI_CONSENT_REQUIRED') setConsentOpen(true);
      setMessages(ms => [...ms, {
        id: newId(), role: 'assistant', error: true,
        text: e.code === 'AI_LIMIT' ? `${e.message} Подключите тариф ИИ, чтобы продолжить.` : e.message || 'Агент не ответил — попробуйте ещё раз.',
      }]);
      if (e.code === 'AI_LIMIT') loadStatus();
    } finally {
      if (running.current === req) running.current = null;
      setSending(false);
      setLiveText('');
      setStopping(false);
    }
  };

  const markStopped = (userMsgId: string) =>
    setMessages(ms => ms.map(m => m.id === userMsgId ? { ...m, stopped: true } : m));

  // «Стоп»: просим сервер остановиться в безопасной точке; молчит — обрываем сами
  const stopRequest = () => {
    const req = running.current;
    if (!req || stopping) return;
    setStopping(true);
    api.aiAssistant.stop(req.id);
    setTimeout(() => { if (running.current === req) req.ctrl.abort(); }, 12000);
  };

  const submit = () => {
    const t = text.trim();
    if (!t && !image) return;
    send({ text: t, images });
    // Печатали с открытой клавиатурой — курсор остаётся в поле, можно писать дальше
    if (focusedRef.current) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  // Нажатие на микрофон: полоса записи — сразу, а микрофон (и в первый раз —
  // вопрос о разрешении) включается параллельно. Раньше экран ждал, пока он
  // включится, — нажатие ощущалось как зависание
  const [starting, setStarting] = useState(false);
  const cancelStart = useRef(false);
  const recUi = !!recording || starting;
  const toggleMic = async () => {
    setMicError(null);
    if (recording) { finishRecording(); return; }
    if (starting) return;
    cancelStart.current = false;
    setRecSeconds(0);
    setStarting(true);
    haptic(10);
    try {
      const r = await startRecording();
      // Пока включался — нажали «✕»
      if (cancelStart.current) { cancelStart.current = false; setStarting(false); await afterPaint(); r.cancel(); return; }
      setRecording(r);
      setStarting(false);
    } catch (e: any) {
      setStarting(false);
      setFromRec(true);
      window.setTimeout(() => setFromRec(false), 320);
      setMicError(e?.name === 'NotAllowedError' ? 'Нет доступа к микрофону — разрешите его в настройках.' : e.message || 'Микрофон недоступен');
    }
  };
  // Остановка микрофона на iPhone тяжёлая (дорожки, аудиоконтекст, перекодирование)
  // и держала экран — отмена ощущалась как зависание. Сначала интерфейс: запись
  // уходит, поле плавно возвращается; тяжёлое — в следующем кадре, после отрисовки
  const [fromRec, setFromRec] = useState(false);
  // После отрисовки и мягкого возврата поля (~0,22 с) — тогда остановка микрофона
  // уже ничего не задерживает на экране
  const afterPaint = () => new Promise<void>(res => requestAnimationFrame(() => setTimeout(res, 240)));
  const leaveRecording = () => {
    setRecording(null);
    setFromRec(true);
    window.setTimeout(() => setFromRec(false), 320);
  };
  const finishRecording = async () => {
    const r = recording; if (!r) return;
    leaveRecording();
    await afterPaint();
    try {
      const audio = await r.stop();
      if (audio.seconds < 0.6) return; // случайное касание
      send({ audio: { data: audio.data, format: audio.format }, voice: Math.round(audio.seconds), images, text: text.trim() || undefined });
    } catch (e: any) { setMicError(e.message); }
  };
  const cancelRecording = async () => {
    // Микрофон ещё включается — запись не начнётся
    if (!recording && starting) { cancelStart.current = true; setStarting(false); haptic(8); setFromRec(true); window.setTimeout(() => setFromRec(false), 320); return; }
    const r = recording; if (!r) return;
    haptic(8);
    leaveRecording();
    await afterPaint();
    r.cancel();
  };

  // Можно выбрать сразу несколько (в медиатеке iPhone — отметить) — до трёх в сообщении
  const pickPhotos = async (files?: FileList | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setMicError(null);
    const csv = list.find(f => /\.csv$/i.test(f.name));
    if (csv) {
      if (list.length !== 1) { setMicError('Выберите один CSV отдельно от фотографий.'); return; }
      if (csv.size > 256 * 1024) { setMicError('CSV должен быть не больше 256 КБ.'); return; }
      try { setStatementRows((await api.aiAssistant.previewStatement(await csv.text())).rows); }
      catch (e: any) { setMicError(e.message); }
      return;
    }
    const room = MAX_PHOTOS - images.length;
    if (room <= 0) { setMicError(`Не больше ${MAX_PHOTOS} фото в одном сообщении`); return; }
    if (list.length > room) setMicError(`Добавлены первые ${room} — не больше ${MAX_PHOTOS} фото в сообщении`);
    try {
      const shrunk = await Promise.all(list.slice(0, room).map(f => compressImage(f)));
      setImages(cur => [...cur, ...shrunk].slice(0, MAX_PHOTOS));
    } catch (e: any) { setMicError(e.message); }
  };

  const confirm = async (msgId: string, a: Action) => {
    patchAction(msgId, a.id, { state: 'busy' });
    const r = await api.aiAssistant.confirm(a.id);
    patchAction(msgId, a.id, { state: r.ok ? 'done' : 'error', result: r.text, undoable: !!r.undoable });
    if (r.ok) onDataChanged();
  };

  // «Отменить» выполненное: платёж, расход, приход, клиент (сервер, 30 минут)
  const undo = async (msgId: string, a: Action) => {
    if (a.kind !== 'confirm' && a.kind !== 'done') return;
    const before = a.state;
    patchAction(msgId, a.id, { state: 'undoing', undoResult: undefined });
    const r = await api.aiAssistant.undo(a.id);
    if (r.ok) {
      patchAction(msgId, a.id, { state: 'undone', undoResult: r.text });
      onDataChanged();
    } else {
      patchAction(msgId, a.id, { state: before, undoResult: r.text } as Partial<Action>);
    }
  };

  // Чек по только что принятому платежу
  const sendReceipt = async (msgId: string, a: Action) => {
    if ((a.kind !== 'confirm' && a.kind !== 'done') || !a.contractId) return;
    patchAction(msgId, a.id, { receipt: 'busy' });
    const r = await onSendDocument(a.contractId, 'receipt', { fresh: true });
    patchAction(msgId, a.id, { receipt: r.ok ? 'done' : 'error', receiptResult: r.text });
  };

  // Договор в «Авто»: сохранить сразу; не вышло — карточка с причиной и формой
  // Фото паспорта поручителя из черновика (guarantorPhoto — номер фото) — берём из
  // сообщения, на которое ответил агент; приложение положит его к клиенту в документы
  const withGuarantorPhoto = (msgId: string, draft: any) => {
    const n = Number(draft?.guarantorPhoto);
    if (!draft?.guarantorName || !(n >= 1)) return draft;
    const at = messages.findIndex(x => x.id === msgId);
    for (let i = at - 1; i >= 0; i--) {
      const u = messages[i];
      if (u.role !== 'user') continue;
      const pics = u.images?.length ? u.images : u.image && u.image !== 'stripped' ? [u.image] : [];
      return pics[n - 1] ? { ...draft, _guarantorPhoto: pics[n - 1] } : draft;
    }
    return draft;
  };
  const clientAction = async (action: Action, perform: () => Promise<any>) => {
    if (!status?.sharedHistory) return perform();
    try {
      const claim = await api.aiAssistant.claimClientAction(action.id);
      if (!claim.claimed) return claim.result || {ok:false,text:'Действие уже начато.'};
      const result = await perform();
      return await api.aiAssistant.finishClientAction(action.id,result) || result;
    } catch (e: any) { return {ok:false,text:e.message || 'Проверьте результат операции перед повтором.'}; }
  };
  const saveContract = async (msgId: string, a: Action) => {
    if (a.kind !== 'contract_form') return;
    patchAction(msgId, a.id, { state: 'saving' });
    const r = await clientAction(a, () => onCreateContract(withGuarantorPhoto(msgId, a.draft)));
    if (!r.ok || !r.saleId) { patchAction(msgId, a.id, { state: 'failed', result: r.text }); return; }
    const saved = { saleId: r.saleId, customerId: r.customerId, number: r.number, total: r.total, monthly: r.monthly, offline: r.offline };
    patchAction(msgId, a.id, { state: 'saved', saved, result: r.text });
    onDataChanged();
    if (a.draft?.sendToWhatsApp && whatsappEnabled) await sendContract(msgId, { ...a, saved });
  };
  const sendContract = async (msgId: string, a: Action) => {
    if (a.kind !== 'contract_form' || !a.saved) return;
    patchAction(msgId, a.id, { send: 'busy' });
    const r = await onSendDocument(a.saved.saleId, 'contract');
    patchAction(msgId, a.id, { send: r.ok ? 'done' : 'error', sendResult: r.text });
  };
  const deleteContract = async (msgId: string, a: Action) => {
    if (a.kind !== 'contract_form' || !a.saved) return;
    patchAction(msgId, a.id, { state: 'deleting' });
    const r = await onDeleteContract(a.saved.saleId);
    patchAction(msgId, a.id, r.ok ? { state: 'deleted', result: r.text } : { state: 'saved', result: r.text });
  };

  const rescheduleConfirmed = async (msgId: string, a: Action) => {
    if (a.kind !== 'reschedule' || !onReschedule) return;
    patchAction(msgId, a.id, { state: 'busy' });
    const r = await clientAction(a, () => onReschedule(a.saleId, a.date));
    patchAction(msgId, a.id, { state: r.ok ? 'done' : 'error', result: r.text });
    if (r.ok) onDataChanged();
  };
  // Удаление договора по просьбе — как вручную (handleDeleteSale в App.tsx)
  const deleteContractConfirmed = async (msgId: string, a: Action) => {
    if (a.kind !== 'delete_contract') return;
    patchAction(msgId, a.id, { state: 'busy' });
    const r = await clientAction(a, () => onDeleteContract(a.saleId));
    patchAction(msgId, a.id, { state: r.ok ? 'done' : 'error', result: r.ok ? 'Договор удалён.' : r.text });
    if (r.ok) onDataChanged();
  };
  const downloadReport = async (msgId: string, a: Action) => {
    if (a.kind !== 'report') return;
    patchAction(msgId, a.id, { state: 'busy' });
    const r = await onExportReport({ from: a.from, to: a.to, onlyActive: a.onlyActive, accountIds: a.accountIds, scopeLabel: a.scopeLabel });
    patchAction(msgId, a.id, { state: r.ok ? 'done' : 'error', result: r.text });
  };

  // Документ клиенту (карточка send_doc)
  const sendDoc = async (msgId: string, a: Action) => {
    if (a.kind !== 'send_doc') return;
    patchAction(msgId, a.id, { state: 'busy' });
    // Договор и чек — один лист с внесёнными платежами: перед любым документом подтягиваем
    // свежие данные, иначе «отправь договор» сразу после платежа мог уйти без этого платежа
    const r = await clientAction(a, () => onSendDocument(a.saleId, a.doc, { fresh: true }));
    patchAction(msgId, a.id, { state: r.ok ? 'done' : 'error', result: r.text });
  };

  // Что в «Авто» делает само приложение: договоры, затем документы (документ —
  // уже с платежом из этого же сообщения: sendDoc всегда подтягивает свежие данные)
  const runAuto = async (msgId: string, actions: Action[]) => {
    for (const a of actions) if (a.kind === 'contract_form' && a.auto) await saveContract(msgId, a);
    for (const a of actions) if (a.kind === 'send_doc' && a.auto) await sendDoc(msgId, a);
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
  const newChat = async () => {
    if (sending) return;
    if (status?.sharedHistory) {
      try { await api.aiAssistant.clearHistory(true); sharedThread.current = null; }
      catch (e: any) { toast.error(e.message); return; }
    }
    writeStore(userId, status?.sharedHistory ? [] : messages, true);
    setPrevChat(status?.sharedHistory ? [] : messages);
    setMessages([]);
  };
  const restorePrev = () => {
    setMessages(prevChat);
    writeStore(userId, [], true);
    setPrevChat([]);
  };
  // Очистить: переписка удаляется с устройства насовсем
  const clearChat = async () => {
    if (status?.sharedHistory) {
      try { await api.aiAssistant.clearHistory(); sharedThread.current = null; }
      catch (e: any) { toast.error(e.message); return; }
    }
    setMessages([]);
    setClearOpen(false);
  };
  const iosApp = isIOSApp();
  const empty = messages.length === 0;

  return (
    <div ref={rootRef} className="ai-chat-root flex flex-col min-h-[calc(100dvh-9rem)] md:min-h-[calc(100dvh-6rem)] max-w-3xl mx-auto w-full">
      {statementRows && <AIStatementPreview rows={statementRows} onClose={() => setStatementRows(null)} onPrepare={t => { setStatementRows(null); send({ text: t, forceConfirm: true }); }} />}
      {journalOpen && <AIAgentJournal onClose={() => setJournalOpen(false)} />}
      {/* Шапка */}
      {/* В пустом чате шар один — большой посередине; маленький в шапке появляется вместе с перепиской */}
      <div className="flex items-center gap-3 pb-3 md:sticky md:top-0 md:z-20 md:pt-3 md:-mt-3 md:bg-slate-50/90 md:dark:bg-slate-900/90 md:backdrop-blur">
        {!empty && <AIOrb size={44} className="ai-msg-in" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">FinUchetGPT</h2>
          <button type="button" onClick={iosApp ? undefined : onOpenTariffs} className={`block text-left text-xs text-slate-500 dark:text-slate-400 ${iosApp ? 'cursor-default' : 'hover:text-violet-600 dark:hover:text-violet-300'}`}>
            {status ? (status.plan ? `${status.plan.name} · осталось ${status.left} из ${status.plan.monthly} в этом месяце` : `Пробный доступ · осталось ${status.left} запросов`) : 'Загружаем…'}
            {status && !iosApp && <span className="ml-1 font-semibold text-violet-600 dark:text-violet-300">· Тарифы ›</span>}
          </button>
        </div>
        {/* Меню «⋯»: на телефоне — в верхней панели (не уезжает при прокрутке), на компьютере — в закреплённой шапке */}
        {topbarSlot && phone
          ? createPortal(<ChatMenu inTopbar hasChat={!empty} busy={sending} onNew={newChat} onClear={() => setClearOpen(true)} onJournal={() => setJournalOpen(true)} onSettings={() => setSettingsOpen(true)} />, topbarSlot)
          : <ChatMenu hasChat={!empty} busy={sending} onNew={newChat} onClear={() => setClearOpen(true)} onJournal={() => setJournalOpen(true)} onSettings={() => setSettingsOpen(true)} />}
      </div>

      {/* Лента. Касание ленты на телефоне закрывает клавиатуру — как в мессенджерах */}
      <div ref={feedRef} className="flex-1 space-y-3 pb-4"
           onPointerDown={e => { if (phone && focused && e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('button, a, input, textarea')) inputRef.current?.blur(); }}>
        {empty && (
          // Невысокий экран телефона (адресная строка, маленький iPhone) — приветствие
          // плотнее, чтобы подсказки не уходили под переключатель режима
          <div className={`ai-msg-in flex flex-col items-center text-center ${shortScreen ? 'pt-1' : 'pt-6'} pb-2`}>
            <AIOrb size={shortScreen ? 52 : 76} />
            <p className={`${shortScreen ? 'mt-2' : 'mt-4'} text-lg font-bold text-slate-900 dark:text-white`}>Чем помочь?</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
              Спросите про долги и платежи, попросите принять платёж или оформить договор. Можно голосом и с фото паспорта.
            </p>
            <div className={`${shortScreen ? 'mt-3' : 'mt-5'} flex flex-wrap justify-center gap-2`}>
              <button onClick={() => send({ text: CONTRACT_SUGGESTION.text })} style={{ animationDelay: '40ms' }}
                      className="ai-msg-in inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-sm font-semibold bg-violet-600 text-white shadow-sm shadow-violet-500/30 hover:bg-violet-700 active:scale-[.97] transition">
                <FileText size={15} /> {CONTRACT_SUGGESTION.label}
              </button>
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
          <div key={m.id} data-old={shownAtOpen.current.has(m.id) || undefined}
               className={`ai-msg-in flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
            {m.role === 'assistant' && <AIOrb size={28} static className="mt-1" />}
            <div className={`max-w-[85%] space-y-2 ${m.role === 'user' ? 'items-end' : ''}`}>
              {(m.text || m.image || m.voice) && (
                <div className={`rounded-3xl px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere] ${
                  m.role === 'user'
                    ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-br-lg'
                    : m.error
                      ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 rounded-bl-lg'
                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700 rounded-bl-lg'}`}>
                  {m.images && m.images.length > 1 ? (
                    <div className="mb-2 flex gap-1.5">
                      {m.images.map((src, i) => <img key={i} src={src} alt="" className="h-28 min-w-0 flex-1 object-cover rounded-2xl" />)}
                    </div>
                  ) : m.image && m.image !== 'stripped' && <img src={m.image} alt="" className="mb-2 max-h-48 rounded-2xl" />}
                  {m.image === 'stripped' && <p className="text-xs opacity-75 mb-1">📷 Фото</p>}
                  {m.voice ? <p className="text-xs opacity-80 mb-0.5">🎙 Голосовое · {m.voice} с</p> : null}
                  {m.heard ? <p className="text-[13px] leading-snug opacity-90 italic mb-0.5">«{m.heard}»</p> : null}
                  {m.role === 'assistant' && !m.error ? renderRich(m.text) : m.text}
                  {m.error && /тариф ИИ/.test(m.text) && !iosApp && (
                    <button onClick={onOpenTariffs} className="block mt-2 text-sm font-bold underline">Тарифы ИИ</button>
                  )}
                </div>
              )}
              {m.stopped && (
                <p className="ai-msg-in text-right text-xs text-slate-400 dark:text-slate-500">
                  Остановлено
                  {m.text && !m.image && !m.voice && !sending && (
                    <> · <button onClick={() => send({ text: m.text, note: m.note })} className="font-semibold text-violet-600 dark:text-violet-300">Повторить</button></>
                  )}
                </p>
              )}
              {!!m.workflow?.plan?.length && <details className="rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm">
                <summary className="cursor-pointer font-semibold">План задачи · {m.workflow.plan.filter(s => s.status === 'done').length} из {m.workflow.plan.length}</summary>
                <ol className="mt-2 space-y-1">{m.workflow.plan.map((s,i) => <li key={i}>{s.status === 'done' ? '✓' : s.status === 'blocked' ? '!' : '○'} {s.title}</li>)}</ol>
                <p className="mt-2 text-xs text-slate-500">Результаты денежных операций — в журнале действий.</p>
              </details>}
              {m.actions?.map(a => (
                <AIActionCard key={a.id} action={a} sending={sending} whatsappEnabled={whatsappEnabled}
                              accountName={a.kind === 'contract_form' ? contractAccountName?.(a.draft) : undefined}
                  choicesActive={m.id === messages[messages.length - 1]?.id}
                  onChoose={i => { if (a.kind !== 'choices') return; patchAction(m.id, a.id, { state: 'done', chosen: i }); send({ text: a.options[i].label, note: a.options[i].ref }); }}
                  onConfirm={() => confirm(m.id, a)}
                  onCancel={() => cancel(m.id, a)}
                  onUndo={() => undo(m.id, a)}
                  onSendReceipt={() => sendReceipt(m.id, a)}
                  onSaveContract={() => saveContract(m.id, a)}
                  onOpenForm={() => { if (a.kind !== 'contract_form') return; onOpenContract(withGuarantorPhoto(m.id, a.draft)); if (a.state !== 'failed') patchAction(m.id, a.id, { state: 'done' }); }}
                  onShowContract={() => { if (a.kind === 'contract_form' && a.saved) onShowContract(a.saved.saleId, a.saved.customerId); }}
                  onSendContract={() => sendContract(m.id, a)}
                  onDeleteContract={() => deleteContract(m.id, a)}
                  onSendDoc={() => sendDoc(m.id, a)}
                  onDownloadReport={() => downloadReport(m.id, a)}
                  onCancelDoc={() => patchAction(m.id, a.id, { state: 'cancelled' })}
                  onConfirmDelete={() => deleteContractConfirmed(m.id, a)}
                  onConfirmReschedule={() => rescheduleConfirmed(m.id, a)}
                  onCancelReschedule={() => patchAction(m.id, a.id, { state: 'cancelled' })}
                  onCancelDelete={() => patchAction(m.id, a.id, { state: 'cancelled' })}
                  onOpenView={() => onOpenWhatsApp?.()}
                  onOpenTemplate={() => { if (a.kind !== 'template_draft') return; onOpenTemplate?.(a.template, a.warnings); patchAction(m.id, a.id, { state: 'done' }); }}
                />
              ))}
            </div>
          </div>
        ))}

        {sending && (
          <div className="ai-msg-in flex gap-2">
            <AIOrb size={28} className="mt-1" />
            {/* Ответ печатается — пузырь с текстом; пока текста нет — точки и что делаю */}
            {liveText.trim() && !stopping ? (
              <div className="max-w-[85%] rounded-3xl rounded-bl-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700 px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">
                {renderRich(livePreview(liveText))}
                <span aria-hidden className="ai-caret inline-block w-[2px] h-[1.05em] -mb-[0.15em] ml-0.5 bg-violet-500 rounded-full" />
              </div>
            ) : (
              <div className="rounded-3xl rounded-bl-lg bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 px-4 py-3 flex gap-1.5 items-center">
                <span className="ai-dot w-2 h-2 rounded-full bg-violet-500" />
                <span className="ai-dot w-2 h-2 rounded-full bg-violet-500" />
                <span className="ai-dot w-2 h-2 rounded-full bg-violet-500" />
                {/* Долгий ответ — видно, что не завис; после «Стоп» — что останавливаем */}
                {stopping
                  ? <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">Останавливаем…</span>
                  : <>
                      {stepLabel && <span key={stepLabel} className="ai-msg-in ml-1.5 text-xs text-slate-500 dark:text-slate-400">{stepLabel}</span>}
                      {elapsed >= 4 && <span className="ml-1 text-xs tabular-nums text-slate-400 dark:text-slate-500">· {elapsed} с</span>}
                    </>}
              </div>
            )}
          </div>
        )}
        {/* Место под полем ввода: последнее сообщение не прячется за ним */}
        <div ref={listEnd} style={{ height: endSpace }} />
      </div>

      {/* Ввод */}
      {/* На телефоне поле ввода прижато к низу экрана (нижней панели здесь нет), на компьютере — к низу колонки */}
      <div ref={composerRef} className="ai-composer fixed md:sticky left-4 right-4 md:left-auto md:right-auto bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:bottom-4 z-20"
           // --pp-comp — поправка, пока страница въезжает/уезжает (см. эффект «Поле у низа экрана»)
           style={{ transform: `translate3d(0, calc(var(--pp-comp, 0px) - ${lift}px), 0)` }}>
        {micError && <p className="ai-msg-in mb-2 text-xs text-rose-600 dark:text-rose-400 text-center">{micError}</p>}
        {/* Карточка ввода, как в нативных чатах: сверху поле во всю ширину (и фото),
            снизу «+», режим агента и микрофон / «Отправить» */}
        {/* Кнопки панели не забирают фокус у поля — клавиатура не прячется на
            «Отправить» и выборе режима (как в нативных чатах). «+» и микрофон
            закрывают её сами: открывается выбор фото / поле уступает записи */}
        <div onMouseDown={e => { if ((e.target as HTMLElement).closest('button:not([data-blur])')) e.preventDefault(); }}
             className={`ai-field relative rounded-[28px] bg-white/90 dark:bg-slate-800/90 backdrop-blur border shadow-lg ${focused ? 'border-violet-300 dark:border-violet-500/50 is-focused' : 'border-slate-200 dark:border-slate-700'}`}>
          {images.length > 0 && (
            <div className="ai-msg-in px-3 pt-3 flex gap-2.5">
              {images.map((src, i) => (
                <div key={i} className="relative inline-block">
                  <img src={src} alt="" className="h-16 rounded-xl" />
                  {/* Номер — им называют фото: «первый — клиент, второй — поручитель» */}
                  {images.length > 1 && (
                    <span className="absolute bottom-1 left-1 min-w-5 h-5 px-1 rounded-full bg-slate-900/75 text-white text-[11px] font-bold leading-5 text-center">{i + 1}</span>
                  )}
                  <button onClick={() => setImages(cur => cur.filter((_, j) => j !== i))} aria-label={`Убрать фото ${i + 1}`}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-900/80 dark:bg-white/90 text-white dark:text-slate-900 text-xs leading-none flex items-center justify-center shadow">✕</button>
                </div>
              ))}
            </div>
          )}
          {/* Набранное во время записи уйдёт вместе с голосовым — показываем его (конец,
              если длинный), иначе буквы вводились бы вслепую */}
          {recUi && text.trim() && (
            <p className="ai-rec-in px-4 pt-2.5 -mb-1 text-[13px] leading-snug text-slate-500 dark:text-slate-400 truncate">
              <span className="font-semibold text-violet-600 dark:text-violet-300">+ текст:</span>{' '}
              {text.length > 48 ? `…${text.slice(-48)}` : text}<span className="ai-caret">▍</span>
            </p>
          )}
          {recUi && (
            <div className="ai-rec-in flex items-center gap-3 h-[52px] px-4 pt-1">
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
          )}
          {/* Поле не убираем на время записи — прячем под полосой, оставляя в фокусе:
              так клавиатура не закрывается, и после записи можно печатать дальше */}
            <textarea ref={inputRef} aria-hidden={recUi || undefined} tabIndex={recUi ? -1 : undefined} value={text} onChange={e => setText(e.target.value)} rows={1}
                      onFocus={() => {
                        focusedRef.current = true;
                        setFocused(true);
                        if (phone) { measureRef.current(); predictKeyboard(); keyboardResync.current(); }
                        // Сдвиг области бывает и после фокуса — пока клавиатура выезжает
                        if (phone) [0, 60, 180, 320].forEach(t => setTimeout(() => { if (focusedRef.current && (window.scrollY > 0 || (window.visualViewport?.offsetTop || 0) > 0)) window.scrollTo(0, 0); }, t));
                      }}
                      onBlur={() => setFocused(false)}
                      // Первое касание: фокус без прокрутки к полю — иначе браузер
                      // уводит страницу вверх. Дальше касания как обычно (курсор, выделение)
                      // Палец коснулся — поле начинает подниматься на запомненную высоту
                      // клавиатуры уже сейчас: к моменту, когда iPhone решает, прокручивать
                      // ли страницу к полю (~100 мс после фокуса), поле уже над клавиатурой.
                      // Палец повёл (прокрутка) или фокуса не случилось — опускаем
                      onTouchStart={e => { touchY.current = e.touches[0]?.clientY ?? 0; if (phone && document.activeElement !== e.currentTarget) preLift(); }}
                      // Дрожь пальца при нажатии — не прокрутка: отменяем, только если повёл заметно
                      onTouchMove={e => { if (Math.abs((e.touches[0]?.clientY ?? 0) - touchY.current) > 10) cancelPreLift(); }}
                      onTouchCancel={() => cancelPreLift()}
                      onTouchEnd={e => {
                        const el = e.currentTarget;
                        if (document.activeElement === el) return;
                        e.preventDefault();
                        el.focus({ preventScroll: true });
                      }}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); submit(); } }}
                      placeholder={image ? 'Что сделать?' : 'Спросите или попросите…'}
                      className={`${recUi ? 'absolute inset-x-0 top-0 h-[52px] opacity-0 pointer-events-none ' : fromRec ? 'ai-field-back ' : ''}ai-input block w-full resize-none bg-transparent outline-none px-4 pt-3.5 pb-1 text-[16px] text-slate-900 dark:text-white placeholder:text-slate-400 max-h-36`} />
          <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
            {recUi ? (
              <button onClick={cancelRecording} aria-label="Отменить запись"
                      className="ai-rec-in w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-90 active:bg-slate-100 dark:active:bg-slate-700 transition text-lg">✕</button>
            ) : (
              // «+» — сразу окно iPhone «Медиатека / Снять фото / Выбрать файл»: открыть
              // медиатеку напрямую веб-страница не может, а своё меню перед ним давало два окна подряд
              <button onClick={() => fileRef.current?.click()} aria-label="Добавить фото" title="Фото"
                      className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition">
                <Plus size={24} strokeWidth={1.8} />
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*,.csv,text/csv" multiple className="hidden" onChange={e => { pickPhotos(e.target.files); e.target.value = ''; }} />
            <div className="flex-1" />
            {!recUi && <ModeMenu mode={mode} onChange={setMode} />}
          {/* Идёт ответ — на месте отправки «Стоп» с бегущим кольцом */}
          {sending && !recUi ? (
            <button onClick={stopRequest} disabled={stopping} aria-label={stopping ? 'Останавливаем' : 'Остановить ответ'} title="Остановить"
                    className="ai-msg-in relative w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-slate-900 dark:bg-white active:scale-95 transition">
              <span aria-hidden className={`ai-busy-ring absolute -inset-[3px] rounded-full ${stopping ? 'opacity-40' : ''}`} />
              <span aria-hidden className={`w-3.5 h-3.5 rounded-[3px] bg-white dark:bg-slate-900 ${stopping ? 'animate-pulse' : ''}`} />
            </button>
          ) : <>
          {/* Микрофон — всегда, пока не набран текст: к фото можно сказать задание голосом */}
          {/* Во время записи — всегда: это «Отправить голосовое», даже если набран текст */}
          {(!text.trim() || recUi) && (
            // Без data-blur: микрофон не забирает фокус у поля — клавиатура остаётся открытой
            <button key="mic" onClick={toggleMic} disabled={sending} aria-label={recUi ? 'Отправить голосовое' : 'Сказать голосом'}
                    // Цвет — сразу, плавно только нажатие: переход цвета шёл в основном потоке
                    // и замирал на красном, пока останавливался микрофон
                    className={`ai-swap relative w-10 h-10 shrink-0 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-60 ${recUi ? 'bg-rose-500 text-white shadow-md' : image ? 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700' : 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md'}`}>
              {recording && <span className="ai-mic-ring absolute inset-0 rounded-full bg-rose-400" />}
              {recUi ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" /></svg>
              )}
            </button>
          )}
          {(text.trim() || image) && !recUi && (
            <button key="send" onClick={submit} disabled={sending} aria-label="Отправить"
                    className="ai-swap w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-md active:scale-95 transition disabled:opacity-60">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          )}
          </>}
          </div>
        </div>
        {status && !status.plan && status.left <= 5 && !iosApp && (
          <button onClick={onOpenTariffs} className="mt-2 block mx-auto text-xs font-semibold text-violet-600 dark:text-violet-300">
            Пробных запросов осталось {status.left} · Тарифы ИИ
          </button>
        )}
      </div>

      {/* Согласие на передачу данных */}
      {settingsOpen && (
        <AIAssistantSettings
          settings={status?.settings || { autoLimit: null, morningDigest: false, digestHour: 9, digestWeekdays: false }}
          onClose={() => setSettingsOpen(false)}
          onSaved={(st: AISettings) => setStatus((x: any) => x ? { ...x, settings: st } : x)}
        />
      )}

      {autoIntro && (
        <Sheet onClose={() => setAutoIntro(false)} className="sm:max-w-md p-6">
          <div className="flex flex-col items-center text-center">
            <span className="w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-br from-amber-400 to-orange-500 text-white"><Zap size={22} /></span>
            <h3 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">Режим «Авто»</h3>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            <li className="flex gap-2"><span className="text-amber-500 shrink-0">⚡</span>Платежи, расходы, приходы и новых клиентов агент проводит сразу — без кнопки «Подтвердить».</li>
            <li className="flex gap-2"><span className="text-amber-500 shrink-0">⚡</span>Договор оформляет сразу, если названы клиент, товар, закуп, срок и наценка или цена. Чего-то нет — сначала спросит.</li>
            <li className="flex gap-2"><span className="text-amber-500 shrink-0">⚡</span>Договор и чек отправляет клиенту в WhatsApp, когда попросите.</li>
            <li className="flex gap-2"><span className="text-violet-500 shrink-0">↩</span>У каждого выполненного действия есть «Отменить» — 30 минут.</li>
          </ul>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button onClick={() => setAutoIntro(false)} className="py-3 rounded-2xl font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 active:scale-[.98] transition">Не сейчас</button>
            <button onClick={acceptAuto} className="py-3 rounded-2xl font-semibold bg-gradient-to-br from-amber-400 to-orange-500 text-white active:scale-[.98] transition">Включить</button>
          </div>
        </Sheet>
      )}

      {clearOpen && (
        <Sheet onClose={() => setClearOpen(false)} className="sm:max-w-sm p-6">
          <div className="flex flex-col items-center text-center">
            <span className="w-12 h-12 rounded-full flex items-center justify-center bg-rose-50 dark:bg-rose-500/10 text-rose-500"><Trash2 size={22} /></span>
            <h3 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">Очистить чат?</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Переписка удалится из общей истории аккаунта и этого устройства. Вернуть её не получится. Данные учёта и журнал действий сохранятся.</p>
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
          {/* Коротко: кому и что уходит — подробно в политике (LegalDocs.tsx) */}
          <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed text-center">
            <p>Ваш запрос — текст, голос, фото — и нужные для ответа данные учёта передаются ИИ-модели.</p>
            <p>Фото паспорта клиента — только с его согласия.</p>
          </div>
          <label className="mt-4 flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
            <input type="checkbox" checked={consentChecked} onChange={e => setConsentChecked(e.target.checked)} className="mt-0.5 w-5 h-5 accent-violet-600" />
            <span>Согласен на обработку данных, в том числе трансграничную, по <a href={`${publicOrigin()}/privacy`} target="_blank" rel="noreferrer" className="text-violet-600 underline">политике обработки данных</a></span>
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
