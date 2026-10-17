import React, { useState } from 'react';
import GlassSheet, { SheetSection, SheetChoice, SheetField, SheetToggle, sheetInputClass } from './GlassSheet';
import { api } from '../services/api';
import { appConfirm } from '../src/dialogs';
import { toast } from '../src/toast';

/**
 * Настройки FinUchetGPT — из меню «⋯» в чате. Хранятся на сервере
 * (users.ai_settings): порог действует на всех устройствах, и соблюдает его
 * сам сервер (server/ai/assistant.js). Новые настройки ассистента — сюда же,
 * отдельной секцией.
 */

export interface AISettings {
  /** В «Авто» сумма от этой и больше ждёт «Подтвердить»; null — без порога */
  autoLimit: number | null;
  /** Утренняя сводка уведомлением */
  morningDigest: boolean;
}

const PRESETS = [10000, 50000, 100000];
const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

const AIAssistantSettings: React.FC<{ settings: AISettings; onClose: () => void; onSaved: (s: AISettings) => void }> = ({ settings, onClose, onSaved }) => {
  const initialCustom = settings.autoLimit != null && !PRESETS.includes(settings.autoLimit);
  const [limitChoice, setLimitChoice] = useState<'none' | 'custom' | number>(
    settings.autoLimit == null ? 'none' : initialCustom ? 'custom' : settings.autoLimit);
  const [custom, setCustom] = useState(initialCustom ? String(settings.autoLimit) : '');
  const [digest, setDigest] = useState(settings.morningDigest);
  const [saving, setSaving] = useState(false);

  const customValue = Math.round(Number(custom.replace(/\s/g, '').replace(',', '.')));
  const customValid = Number.isFinite(customValue) && customValue > 0;
  const nextLimit = limitChoice === 'none' ? null : limitChoice === 'custom' ? (customValid ? customValue : NaN) : limitChoice;
  const valid = !(limitChoice === 'custom' && !customValid);
  const dirty = nextLimit !== settings.autoLimit || digest !== settings.morningDigest;

  const save = async (close: () => void) => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const r = await api.aiAssistant.saveSettings({ autoLimit: nextLimit as number | null, morningDigest: digest });
      onSaved(r.settings);
      toast.success('Настройки сохранены');
      close();
    } catch {
      toast.error('Не удалось сохранить', { message: 'Проверьте связь и попробуйте ещё раз.' });
      setSaving(false);
    }
  };

  return (
    <GlassSheet
      title="Настройки ассистента"
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
          hint="В «Авто» платёж, расход или приход от этой суммы всё равно ждёт «Подтвердить». Договор — по сумме закупа. В режиме «Подтверждать» подтверждаете всё, как раньше."
        >
          {PRESETS.map(n => (
            <SheetChoice key={n} selected={limitChoice === n} label={`От ${rub(n)}`} onSelect={() => setLimitChoice(n)} />
          ))}
          <SheetChoice selected={limitChoice === 'custom'} label="Своя сумма" onSelect={() => setLimitChoice('custom')} />
          {limitChoice === 'custom' && (
            <SheetField label="Подтверждать от, ₽" hint={!custom || customValid ? undefined : 'Введите сумму больше нуля'}>
              <input className={sheetInputClass} inputMode="numeric" autoFocus value={custom}
                     onChange={e => setCustom(e.target.value.replace(/[^\d\s]/g, ''))} placeholder="Например, 30 000" />
            </SheetField>
          )}
          <SheetChoice selected={limitChoice === 'none'} label="Без порога" hint="«Авто» проводит любые суммы сразу" onSelect={() => setLimitChoice('none')} />
        </SheetSection>

        <SheetSection title="Уведомления">
          <SheetToggle
            label="Утренняя сводка"
            description="В 9:00 по Москве: сколько платежей ждём сегодня и кто просрочил"
            checked={digest}
            onChange={setDigest}
          />
        </SheetSection>
      </div>
    </GlassSheet>
  );
};

export default AIAssistantSettings;
