import React, { useState } from 'react';
import GlassSheet, { SheetSection, SheetChoice, SheetField, SheetToggle, sheetInputClass } from './GlassSheet';
import { api } from '../services/api';
import { appConfirm } from '../src/dialogs';
import { toast } from '../src/toast';

/**
 * Настройки FinUchetGPT — из меню «⋯» в чате. Хранятся на сервере
 * (users.ai_settings): порог действует на всех устройствах, и соблюдает его
 * сам сервер (server/ai/assistant.js). Новые настройки агента — сюда же,
 * отдельной секцией.
 */

export interface AISettings {
  /** В «Авто» сумма от этой и больше ждёт «Подтвердить»; null — без порога */
  autoLimit: number | null;
  /** Утренняя сводка уведомлением */
  morningDigest: boolean;
  /** В котором часу по Москве (6–22) */
  digestHour?: number;
  /** Только по будням */
  digestWeekdays?: boolean;
}

// Час сводки — с 6 до 22 по Москве; самые частые — кнопками, остальные в списке
const QUICK_HOURS = [7, 8, 9, 10];
const ALL_HOURS = Array.from({ length: 17 }, (_, i) => i + 6);


const AIAssistantSettings: React.FC<{ settings: AISettings; onClose: () => void; onSaved: (s: AISettings) => void }> = ({ settings, onClose, onSaved }) => {
  const [limitChoice, setLimitChoice] = useState<'none' | 'custom'>(settings.autoLimit == null ? 'none' : 'custom');
  const [custom, setCustom] = useState(settings.autoLimit != null ? settings.autoLimit.toLocaleString('ru-RU') : '');
  const [digest, setDigest] = useState(settings.morningDigest);
  const [hour, setHour] = useState(settings.digestHour ?? 9);
  const [weekdays, setWeekdays] = useState(!!settings.digestWeekdays);
  const [saving, setSaving] = useState(false);

  const customValue = Math.round(Number(custom.replace(/\s/g, '').replace(',', '.')));
  const customValid = Number.isFinite(customValue) && customValue > 0;
  const nextLimit = limitChoice === 'none' ? null : customValid ? customValue : NaN;
  const valid = !(limitChoice === 'custom' && !customValid);
  const dirty = nextLimit !== settings.autoLimit || digest !== settings.morningDigest
    || hour !== (settings.digestHour ?? 9) || weekdays !== !!settings.digestWeekdays;

  const save = async (close: () => void) => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const r = await api.aiAssistant.saveSettings({ autoLimit: nextLimit as number | null, morningDigest: digest, digestHour: hour, digestWeekdays: weekdays });
      onSaved(r.settings);
      toast.success('Настройки сохранены');
      close();
    } catch (e: any) {
      toast.error('Не удалось сохранить', { message: e?.message && e.message !== 'Не удалось сохранить' ? e.message : 'Проверьте связь и попробуйте ещё раз.' });
      setSaving(false);
    }
  };

  return (
    <GlassSheet
      title="Настройки агента"
      onClose={onClose}
      cancelLabel="Закрыть"
      action={{ label: saving ? 'Сохраняем…' : 'Готово', onClick: save, disabled: !valid || saving || !dirty }}
      confirmClose={() => !dirty || appConfirm({
        title: 'Закрыть без сохранения?', message: 'Изменения настроек пропадут.',
        confirmLabel: 'Закрыть', cancelLabel: 'Остаться', destructive: true,
      })}
    >
      <div className="space-y-6">
        <SheetSection
          title="Порог для режима «Авто»"
          hint="В «Авто» платёж, расход или приход от этой суммы ждёт «Подтвердить»; договор — по закупу."
        >
          <SheetChoice selected={limitChoice === 'none'} label="Без порога" onSelect={() => setLimitChoice('none')} />
          <SheetChoice selected={limitChoice === 'custom'} label="Своя сумма" onSelect={() => setLimitChoice('custom')} />
          {limitChoice === 'custom' && (
            <SheetField label="Подтверждать от, ₽" hint={!custom || customValid ? undefined : 'Введите сумму больше нуля'}>
              <input className={sheetInputClass} inputMode="numeric" autoFocus value={custom}
                     onChange={e => setCustom(e.target.value.replace(/[^\d\s]/g, ''))} placeholder="Например, 30 000" />
            </SheetField>
          )}
        </SheetSection>

        <SheetSection title="Уведомления"
                      hint={digest ? 'Время — московское. Сводка приходит раз в день; поменяли время сегодня — придёт в новое, если ещё не приходила.' : undefined}>
          <SheetToggle
            label="Утренняя сводка"
            description={`${weekdays ? 'По будням' : 'Каждый день'} в ${hour}:00 — сообщением в чате агента и уведомлением: сколько платежей ждём сегодня, кто просрочил, сколько получено вчера`}
            checked={digest}
            onChange={setDigest}
          />
          {digest && (
            <>
              <div className="px-4 py-3 space-y-2">
                <div className="text-[13px] text-slate-500 dark:text-slate-400">Во сколько</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {QUICK_HOURS.map(h => (
                    <button key={h} type="button" onClick={() => setHour(h)}
                            className={`py-2 rounded-xl text-sm font-semibold tabular-nums ${hour === h ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                      {h}:00
                    </button>
                  ))}
                  {/* Другое время — списком, чтобы не держать на экране 17 кнопок */}
                  <select value={QUICK_HOURS.includes(hour) ? '' : hour} onChange={e => e.target.value && setHour(Number(e.target.value))}
                          aria-label="Другое время"
                          className={`py-2 rounded-xl text-sm font-semibold text-center appearance-none ${QUICK_HOURS.includes(hour) ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' : 'bg-violet-600 text-white'}`}>
                    <option value="">Другое</option>
                    {ALL_HOURS.filter(h => !QUICK_HOURS.includes(h)).map(h => <option key={h} value={h}>{h}:00</option>)}
                  </select>
                </div>
              </div>
              <SheetToggle label="Только по будням" description="В субботу и воскресенье сводки не будет" checked={weekdays} onChange={setWeekdays} />
            </>
          )}
        </SheetSection>
      </div>
    </GlassSheet>
  );
};

export default AIAssistantSettings;
