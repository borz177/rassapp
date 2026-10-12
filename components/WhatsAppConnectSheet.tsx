import React, { useEffect, useRef, useState } from 'react';
import GlassSheet, { SheetSection, SheetSegmented } from './GlassSheet';
import { api } from '../services/api';
import { isPhoneWidth } from '../src/sheetDrag';

/**
 * Подключение WhatsApp прямо в приложении — без регистрации у сторонних
 * сервисов и без ключей. Сервер заводит сессию в нашем WhatsApp-сервисе, а
 * человек привязывает номер как «связанное устройство»: кодом по номеру
 * телефона (на телефоне QR нечем сканировать — он на том же экране) или
 * QR-кодом с компьютера. Пока окно открыто, статус опрашивается сам.
 */

interface Props {
  onClose: () => void;
  /** Номер привязан — настройки включаются этим способом */
  onConnected: (phone: string | null) => void;
}

const POLL_MS = 2500;
// WhatsApp меняет QR каждые ~20 секунд, а сервис закрывает канал через минуту;
// запрашиваем чаще, чтобы показывать свежий и сразу подхватывать перезапуск
const QR_REFRESH_MS = 8000;

const formatCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);
const formatPhone = (digits?: string | null) =>
  digits && /^7\d{10}$/.test(digits)
    ? `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
    : digits ? `+${digits}` : '';

const Step: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <li className="flex gap-3 px-4 py-3">
    <span className="w-6 h-6 shrink-0 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 text-[13px] font-bold flex items-center justify-center">{n}</span>
    <span className="text-[15px] leading-snug text-slate-700 dark:text-slate-200">{children}</span>
  </li>
);

const WhatsAppConnectSheet: React.FC<Props> = ({ onClose, onConnected }) => {
  const [stage, setStage] = useState<'starting' | 'linking' | 'done' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<'code' | 'qr'>(() => (isPhoneWidth() ? 'code' : 'qr'));
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Завести сессию и подключиться к серверам WhatsApp
  const start = async () => {
    setStage('starting');
    setError(null);
    try {
      const r = await api.waBuiltin.start();
      if (!alive.current) return;
      setStage('linking');
      if (r.loggedIn) checkStatus();
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : 'Не удалось начать подключение');
      setStage('error');
    }
  };
  useEffect(() => { start(); }, []);

  const checkStatus = async () => {
    try {
      const st = await api.waBuiltin.status();
      if (!alive.current) return;
      if (st.loggedIn) {
        setLinkedPhone(st.phone || null);
        setStage('done');
      }
    } catch { /* следующая попытка через пару секунд */ }
  };

  // Опрос статуса, пока ждём привязку
  useEffect(() => {
    if (stage !== 'linking') return;
    const timer = window.setInterval(checkStatus, POLL_MS);
    return () => window.clearInterval(timer);
  }, [stage]);

  // QR — сразу и с обновлением, пока выбран этот способ
  useEffect(() => {
    if (stage !== 'linking' || method !== 'qr') return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.waBuiltin.qr();
        if (cancelled || !alive.current) return;
        if (r.loggedIn) { checkStatus(); return; }
        setQr(r.qr || null);
      } catch { /* покажем прежний, обновим в следующий раз */ }
    };
    load();
    const timer = window.setInterval(load, QR_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [stage, method]);

  const requestCode = async () => {
    setCodeLoading(true);
    setError(null);
    setCode(null);
    try {
      const r = await api.waBuiltin.pair(phone);
      if (!alive.current) return;
      if ((r as any).loggedIn) { checkStatus(); return; }
      setCode(r.code);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Не удалось получить код');
    } finally {
      if (alive.current) setCodeLoading(false);
    }
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => alive.current && setCopied(false), 1800);
    } catch { /* без буфера обмена код всё равно виден */ }
  };

  const phoneDigits = phone.replace(/\D/g, '');

  return (
    <GlassSheet
      title="Подключить WhatsApp"
      subtitle="Напоминания и документы клиентам с вашего номера"
      onClose={onClose}
      action={stage === 'done' ? { label: 'Готово', onClick: close => { onConnected(linkedPhone); close(); } } : undefined}
    >
      <div className="space-y-6">
        {stage === 'starting' && (
          <div className="py-10 flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
            <span className="w-8 h-8 rounded-full border-[3px] border-emerald-500 border-t-transparent animate-spin" />
            <span className="text-[15px]">Готовим подключение…</span>
          </div>
        )}

        {stage === 'error' && (
          <SheetSection>
            <div className="p-4 space-y-3">
              <p className="text-[15px] text-rose-600 dark:text-rose-400">{error}</p>
              <button type="button" onClick={start}
                      className="w-full h-11 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[15px] font-semibold active:opacity-80">
                Попробовать снова
              </button>
            </div>
          </SheetSection>
        )}

        {stage === 'done' && (
          <div className="py-8 flex flex-col items-center text-center gap-3">
            <span className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </span>
            <p className="text-[20px] font-bold text-slate-900 dark:text-white">WhatsApp подключён</p>
            {linkedPhone && <p className="text-[15px] text-slate-500 dark:text-slate-400">{formatPhone(linkedPhone)}</p>}
            <p className="text-[14px] leading-snug text-slate-500 dark:text-slate-400 max-w-xs">
              Напоминания включены: в день оплаты в 10:00. Время, дни и шаблоны — в настройках ниже.
            </p>
            <button type="button" onClick={() => { onConnected(linkedPhone); onClose(); }}
                    className="mt-2 w-full h-12 rounded-2xl bg-emerald-600 text-white text-[16px] font-semibold active:opacity-80">
              Готово
            </button>
          </div>
        )}

        {stage === 'linking' && (
          <>
            <SheetSegmented
              value={method}
              onChange={m => { setMethod(m); setError(null); }}
              options={[{ id: 'code', label: 'По номеру' }, { id: 'qr', label: 'QR-код' }]}
            />

            {method === 'code' && (
              <>
                {!code ? (
                  <SheetSection hint="Номер, на котором установлен WhatsApp — с него и будут уходить сообщения клиентам.">
                    <div className="p-4 space-y-3">
                      <input
                        type="tel" inputMode="tel" autoComplete="tel"
                        value={phone} onChange={e => setPhone(e.target.value)}
                        placeholder="+7 900 000-00-00"
                        className="w-full h-12 px-4 rounded-xl bg-slate-100 dark:bg-slate-900 text-[17px] text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/40"
                      />
                      <button type="button" onClick={requestCode} disabled={codeLoading || phoneDigits.length < 10}
                              className="w-full h-12 rounded-xl bg-emerald-600 text-white text-[16px] font-semibold disabled:opacity-40 active:opacity-80 flex items-center justify-center gap-2">
                        {codeLoading && <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                        Получить код
                      </button>
                    </div>
                  </SheetSection>
                ) : (
                  <SheetSection title="Код для WhatsApp">
                    <div className="p-5 flex flex-col items-center gap-3">
                      <span className="font-mono text-[34px] font-bold tracking-[0.12em] text-slate-900 dark:text-white select-all">{formatCode(code)}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={copyCode}
                                className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-700 text-[14px] font-semibold text-slate-700 dark:text-slate-200 active:opacity-70">
                          {copied ? 'Скопировано' : 'Скопировать'}
                        </button>
                        <button type="button" onClick={() => { setCode(null); setError(null); }}
                                className="h-10 px-4 rounded-xl text-[14px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70">
                          Другой номер
                        </button>
                      </div>
                    </div>
                  </SheetSection>
                )}

                <SheetSection title="Где ввести код">
                  <ol className="divide-y divide-slate-100 dark:divide-slate-700/70">
                    <Step n={1}>Откройте WhatsApp на телефоне с этим номером</Step>
                    <Step n={2}>Настройки → <b>Связанные устройства</b> → <b>Привязка устройства</b></Step>
                    <Step n={3}>Нажмите <b>«Связать по номеру телефона»</b> и введите код</Step>
                  </ol>
                </SheetSection>
              </>
            )}

            {method === 'qr' && (
              <>
                <SheetSection>
                  <div className="p-5 flex justify-center">
                    {qr
                      ? <img src={qr} alt="QR-код для привязки WhatsApp" className="w-60 h-60 rounded-xl bg-white p-2" />
                      : <span className="w-60 h-60 rounded-xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                          <span className="w-8 h-8 rounded-full border-[3px] border-emerald-500 border-t-transparent animate-spin" />
                        </span>}
                  </div>
                </SheetSection>
                <SheetSection title="Как отсканировать">
                  <ol className="divide-y divide-slate-100 dark:divide-slate-700/70">
                    <Step n={1}>Откройте WhatsApp на телефоне</Step>
                    <Step n={2}>Настройки → <b>Связанные устройства</b> → <b>Привязка устройства</b></Step>
                    <Step n={3}>Наведите камеру на код — он обновляется сам</Step>
                  </ol>
                </SheetSection>
              </>
            )}

            {error && <p className="px-1 text-[14px] text-rose-600 dark:text-rose-400">{error}</p>}

            <div className="flex items-center justify-center gap-2 text-[13px] text-slate-400 dark:text-slate-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Ждём привязку — окно само увидит, когда всё готово
            </div>

            <p className="px-1 text-[12px] leading-snug text-slate-400 dark:text-slate-500">
              Подключение неофициальное: при массовых рассылках WhatsApp может ограничить номер.
              Лучше использовать отдельный номер или WhatsApp Business.
            </p>
          </>
        )}
      </div>
    </GlassSheet>
  );
};

export default WhatsAppConnectSheet;
