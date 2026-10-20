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
  voice?: number; // длительность голосового, с
  heard?: string; // расшифровка голосового (сервер) — видна под ним и уходит в историю
  note?: string; // для агента, не показывается: id варианта, выбранного кнопкой
  stopped?: boolean; // человек нажал «Стоп», ответа не было
  actions?: Action[];
  error?: boolean;
}

interface Props {
  userId: string;
  onBack: () => void;
  /** Черновик договора от агента → форма договора */
  onOpenContract: (draft: any) => void;
  /** «Авто»: оформить договор сразу, без формы */
  onCreateContract: (draft: any) => Promise<{ ok: boolean; text: string; saleId?: string; customerId?: string; number?: string; monthly?: number; total?: number; offline?: boolean }>;
  /** PDF договора или чека клиенту в WhatsApp; fresh — сначала подтянуть данные (чек сразу после платежа) */
  onSendDocument: (saleId: string, kind: 'contract' | 'receipt', opts?: { fresh?: boolean }) => Promise<{ ok: boolean; text: string }>;
  /** «Отменить договор», оформленный в «Авто» */
  onDeleteContract: (saleId: string) => Promise<{ ok: boolean; text: string }>;
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
    if (prev && !msgs.length) { localStorage.removeItem(storeKey(userId, true)); return; }
    // Без фото: они тяжёлые и это паспорта
    localStorage.setItem(storeKey(userId, prev), JSON.stringify(msgs.slice(-40).map(m => ({ ...m, image: m.image ? 'stripped' : undefined }))));
  } catch { /* место кончилось или приватный режим — история просто не сохранится */ }
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
const ChatMenu: React.FC<{ hasChat: boolean; busy: boolean; onNew: () => void; onClear: () => void; onSettings: () => void; inTopbar?: boolean }> = ({ hasChat, busy, onNew, onClear, onSettings, inTopbar }) => {
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
          {item('Настройки агента', Settings2, onSettings)}
        </div>
      )}
    </div>
  );
};

const AIAssistant: React.FC<Props> = ({ userId, onBack, onOpenContract, onCreateContract, onSendDocument, onDeleteContract, onShowContract, onExportReport, whatsappEnabled, onDataChanged, onOpenTariffs, contractAccountName, onOpenWhatsApp }) => {
  const [status, setStatus] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>(() => readStore(userId));
  // Сообщения, что были при открытии, — без анимации появления: иначе вся
  // история разворачивалась заново и лента росла уже после прокрутки вниз
  const shownAtOpen = useRef<Set<string>>(new Set(messages.map(m => m.id)));
  const [prevChat, setPrevChat] = useState<Msg[]>(() => readStore(userId, true));
  const [clearOpen, setClearOpen] = useState(false);
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
  const [image, setImage] = useState<string | null>(null);
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
  useEffect(() => { if (recording) setFocused(false); }, [recording]);
  const safeBottom = useRef(0);
  // Перепроверить высоту клавиатуры (см. ниже) — из фокуса поля
  const keyboardResync = useRef<() => void>(() => {});
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
      setKeyboard(prev => (Math.abs(prev - k) < 6 && (prev > 0) === (k > 0) ? prev : k));
    };
    const sync = () => { if (!frame) frame = requestAnimationFrame(apply); };
    // Первое открытие клавиатуры в PWA на iPhone: высоту она сообщает, ещё не
    // выехав до конца (без строки подсказок), а финального события иногда нет —
    // панель вставала чуть ниже, «за» клавиатурой; во второй раз было верно.
    // После фокуса перепроверяем, когда клавиатура уже точно на месте
    keyboardResync.current = () => [120, 350, 700].forEach(t => setTimeout(sync, t));
    apply();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => { cancelAnimationFrame(frame); vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync); };
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
  const wasLifted = useRef(false);
  useLayoutEffect(() => {
    const el = composerRef.current; if (!el) return;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') return;
    setEndSpace(Math.max(0, Math.round(el.offsetHeight + (parseFloat(cs.bottom) || 0) + lift)));
    const lifted = lift > 0;
    if (lifted !== wasLifted.current && atBottom.current) requestAnimationFrame(() => scrollToEnd(true));
    wasLifted.current = lifted;
  }, [lift]);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadStatus = () => api.aiAssistant.status().then(s => {
    setStatus(s);
    if (!s.consent) setConsentOpen(true);
    showDigest(s.digest);
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
      id: newId(), role: 'assistant', text: `☀️ **План на сегодня**\n${digest.text.replace(/ — спросите FinUchetGPT.*$/, '.')}`,
      actions: [{ id: newId(), kind: 'choices', title: 'Что дальше?', options: digestOptions(digest.stats) }],
    }]);
  };
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { writeStore(userId, messages); }, [messages, userId]);
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
    const touched = () => { userAt = Date.now(); };
    const onScroll = () => {
      if (Date.now() - userAt > 1000) return;
      const top = el ? el.scrollTop : window.scrollY;
      const max = el ? el.scrollHeight - el.clientHeight : document.documentElement.scrollHeight - window.innerHeight;
      atBottom.current = max - top < 80;
    };
    const ro = new ResizeObserver(() => { if (atBottom.current) scrollToEnd(false); });
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

  const send = async (payload: { text?: string; image?: string | null; audio?: { data: string; format: string }; voice?: number; note?: string }) => {
    if (sending) return;
    if (status && !status.consent) { setConsentOpen(true); return; }
    const userMsg: Msg = { id: newId(), role: 'user', text: payload.text || '', image: payload.image || undefined, voice: payload.voice, note: payload.note };
    const history = toHistory(messages);
    setMessages(ms => [...ms, userMsg]);
    setText(''); setImage(null);
    setSending(true);
    const req = { id: newId(), ctrl: new AbortController(), userMsgId: userMsg.id };
    running.current = req;
    setStepLabel('');
    setLiveText('');
    try {
      const r = await api.aiAssistant.message({
        text: [payload.text, payload.note && `[${payload.note}]`].filter(Boolean).join(' '),
        history, image: payload.image || undefined, audio: payload.audio, mode, requestId: req.id,
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
      const msgId = newId();
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
    send({ text: t, image });
    // Печатали с открытой клавиатурой — курсор остаётся в поле, можно писать дальше
    if (focusedRef.current) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
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
  const saveContract = async (msgId: string, a: Action) => {
    if (a.kind !== 'contract_form') return;
    patchAction(msgId, a.id, { state: 'saving' });
    const r = await onCreateContract(a.draft);
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

  // Удаление договора по просьбе — как вручную (handleDeleteSale в App.tsx)
  const deleteContractConfirmed = async (msgId: string, a: Action) => {
    if (a.kind !== 'delete_contract') return;
    patchAction(msgId, a.id, { state: 'busy' });
    const r = await onDeleteContract(a.saleId);
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
  const sendDoc = async (msgId: string, a: Action, fresh = false) => {
    if (a.kind !== 'send_doc') return;
    patchAction(msgId, a.id, { state: 'busy' });
    const r = await onSendDocument(a.saleId, a.doc, { fresh: fresh || a.doc === 'receipt' });
    patchAction(msgId, a.id, { state: r.ok ? 'done' : 'error', result: r.text });
  };

  // Что в «Авто» делает само приложение: договоры, затем документы (чек — уже
  // с платежом из этого же сообщения)
  const runAuto = async (msgId: string, actions: Action[]) => {
    for (const a of actions) if (a.kind === 'contract_form' && a.auto) await saveContract(msgId, a);
    const paid = actions.some(a => a.kind === 'done' && a.ok && a.tool === 'create_payment');
    for (const a of actions) if (a.kind === 'send_doc' && a.auto) await sendDoc(msgId, a, paid);
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
    <div ref={rootRef} className="ai-chat-root flex flex-col min-h-[calc(100dvh-9rem)] md:min-h-[calc(100dvh-6rem)] max-w-3xl mx-auto w-full">
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
          ? createPortal(<ChatMenu inTopbar hasChat={!empty} busy={sending} onNew={newChat} onClear={() => setClearOpen(true)} onSettings={() => setSettingsOpen(true)} />, topbarSlot)
          : <ChatMenu hasChat={!empty} busy={sending} onNew={newChat} onClear={() => setClearOpen(true)} onSettings={() => setSettingsOpen(true)} />}
      </div>

      {/* Лента. Касание ленты на телефоне закрывает клавиатуру — как в мессенджерах */}
      <div className="flex-1 space-y-3 pb-4"
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
                  {m.image && m.image !== 'stripped' && <img src={m.image} alt="" className="mb-2 max-h-48 rounded-2xl" />}
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
                  onOpenForm={() => { if (a.kind !== 'contract_form') return; onOpenContract(a.draft); if (a.state !== 'failed') patchAction(m.id, a.id, { state: 'done' }); }}
                  onShowContract={() => { if (a.kind === 'contract_form' && a.saved) onShowContract(a.saved.saleId, a.saved.customerId); }}
                  onSendContract={() => sendContract(m.id, a)}
                  onDeleteContract={() => deleteContract(m.id, a)}
                  onSendDoc={() => sendDoc(m.id, a)}
                  onDownloadReport={() => downloadReport(m.id, a)}
                  onCancelDoc={() => patchAction(m.id, a.id, { state: 'cancelled' })}
                  onConfirmDelete={() => deleteContractConfirmed(m.id, a)}
                  onCancelDelete={() => patchAction(m.id, a.id, { state: 'cancelled' })}
                  onOpenView={() => onOpenWhatsApp?.()}
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
           style={lift ? { transform: `translate3d(0, ${-lift}px, 0)` } : undefined}>
        {micError && <p className="ai-msg-in mb-2 text-xs text-rose-600 dark:text-rose-400 text-center">{micError}</p>}
        {/* Карточка ввода, как в нативных чатах: сверху поле во всю ширину (и фото),
            снизу «+», режим агента и микрофон / «Отправить» */}
        {/* Кнопки панели не забирают фокус у поля — клавиатура не прячется на
            «Отправить» и выборе режима (как в нативных чатах). «+» и микрофон
            закрывают её сами: открывается выбор фото / поле уступает записи */}
        <div onMouseDown={e => { if ((e.target as HTMLElement).closest('button:not([data-blur])')) e.preventDefault(); }}
             className={`ai-field rounded-[28px] bg-white/90 dark:bg-slate-800/90 backdrop-blur border shadow-lg ${focused ? 'border-violet-300 dark:border-violet-500/50 is-focused' : 'border-slate-200 dark:border-slate-700'}`}>
          {image && (
            <div className="ai-msg-in px-3 pt-3">
              <div className="relative inline-block">
                <img src={image} alt="" className="h-16 rounded-xl" />
                <button onClick={() => setImage(null)} aria-label="Убрать фото"
                        className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-900/80 dark:bg-white/90 text-white dark:text-slate-900 text-xs leading-none flex items-center justify-center shadow">✕</button>
              </div>
            </div>
          )}
          {recording ? (
            <div className="flex items-center gap-3 h-[52px] px-4 pt-1">
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
          ) : (
            <textarea ref={inputRef} value={text} onChange={e => setText(e.target.value)} rows={1}
                      onFocus={() => {
                        focusedRef.current = true;
                        setFocused(true);
                        if (phone) { measureRef.current(); keyboardResync.current(); }
                        // Сдвиг области бывает и после фокуса — пока клавиатура выезжает
                        if (phone) [0, 60, 180, 320].forEach(t => setTimeout(() => { if (focusedRef.current && (window.scrollY > 0 || (window.visualViewport?.offsetTop || 0) > 0)) window.scrollTo(0, 0); }, t));
                      }}
                      onBlur={() => setFocused(false)}
                      // Первое касание: фокус без прокрутки к полю — иначе браузер
                      // уводит страницу вверх. Дальше касания как обычно (курсор, выделение)
                      onTouchEnd={e => {
                        const el = e.currentTarget;
                        if (document.activeElement === el) return;
                        e.preventDefault();
                        el.focus({ preventScroll: true });
                      }}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); submit(); } }}
                      placeholder={image ? 'Что сделать?' : 'Спросите или попросите…'}
                      className="ai-input block w-full resize-none bg-transparent outline-none px-4 pt-3.5 pb-1 text-[16px] text-slate-900 dark:text-white placeholder:text-slate-400 max-h-36" />
          )}
          <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
            {recording ? (
              <button onClick={cancelRecording} aria-label="Отменить запись"
                      className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-lg">✕</button>
            ) : (
              <button data-blur onClick={() => fileRef.current?.click()} aria-label="Добавить фото" title="Фото"
                      className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition">
                <Plus size={24} strokeWidth={1.8} />
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="flex-1" />
            {!recording && <ModeMenu mode={mode} onChange={setMode} />}
          {/* Идёт ответ — на месте отправки «Стоп» с бегущим кольцом */}
          {sending && !recording ? (
            <button onClick={stopRequest} disabled={stopping} aria-label={stopping ? 'Останавливаем' : 'Остановить ответ'} title="Остановить"
                    className="ai-msg-in relative w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-slate-900 dark:bg-white active:scale-95 transition">
              <span aria-hidden className={`ai-busy-ring absolute -inset-[3px] rounded-full ${stopping ? 'opacity-40' : ''}`} />
              <span aria-hidden className={`w-3.5 h-3.5 rounded-[3px] bg-white dark:bg-slate-900 ${stopping ? 'animate-pulse' : ''}`} />
            </button>
          ) : <>
          {/* Микрофон — всегда, пока не набран текст: к фото можно сказать задание голосом */}
          {!text.trim() && (
            <button key="mic" data-blur onClick={toggleMic} disabled={sending} aria-label={recording ? 'Отправить голосовое' : 'Сказать голосом'}
                    className={`ai-swap relative w-10 h-10 shrink-0 rounded-full flex items-center justify-center active:scale-95 transition disabled:opacity-60 ${recording ? 'bg-rose-500 text-white shadow-md' : image ? 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700' : 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md'}`}>
              {recording && <span className="ai-mic-ring absolute inset-0 rounded-full bg-rose-400" />}
              {recording ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" /></svg>
              )}
            </button>
          )}
          {(text.trim() || image) && !recording && (
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
