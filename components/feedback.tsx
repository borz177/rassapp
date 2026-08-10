import React from 'react';

// Подтверждение завершённой операции в духе нативных приложений: пружинный «поп»,
// галочка, которая рисуется штрихом, и расходящееся кольцо. Ключевые кадры лежат
// в src/index.css (блок «ОФОРМЛЕНИЕ И ОТПРАВКА ДОГОВОРА»), там же учтён
// системный режим «уменьшить движение».

// Короткая вибро-отдача. Работает в Android-обёртке и Chrome; на iOS и десктопе
// Vibration API отсутствует — просто ничего не произойдёт.
export const haptic = (pattern: number | number[] = 12) => {
  try { navigator.vibrate?.(pattern); } catch { /* устройство без вибромотора */ }
};

// Двойной короткий отклик — «операция завершена»
export const hapticSuccess = () => haptic([12, 60, 18]);

export type FeedbackTone = 'success' | 'danger';

const TONES: Record<FeedbackTone, { stroke: string; ring: string }> = {
  // Приход, оформление, выполненная задача
  success: { stroke: 'stroke-emerald-500', ring: 'border-emerald-400' },
  // Расход: деньги ушли со счёта — это не должно выглядеть так же, как поступление
  danger: { stroke: 'stroke-rose-500', ring: 'border-rose-400' },
};

export const SuccessCheck: React.FC<{ size?: number; tone?: FeedbackTone }> = ({
  size = 72,
  tone = 'success',
}) => {
  const { stroke, ring } = TONES[tone];
  return (
    <div className="relative mx-auto animate-success-pop" style={{ width: size, height: size }}>
      <span className={`absolute inset-0 rounded-full border-2 ${ring} animate-success-ripple`} />
      <svg viewBox="0 0 60 60" width={size} height={size} fill="none" className="relative">
        <circle
          cx="30" cy="30" r="26"
          className={`success-ring ${stroke}`}
          strokeWidth="3.5" strokeLinecap="round"
          transform="rotate(-90 30 30)"
        />
        <path
          d="M18 30.5 L26 38.5 L42 22"
          className={`success-check ${stroke}`}
          strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

// Стадии отправки документа: пока идёт генерация PDF и заливка в WhatsApp,
// пользователь видит, на каком шаге процесс, а не пустое окно.
export type SendStage = 'idle' | 'pdf' | 'upload' | 'done';

export const SendStageView: React.FC<{
  stage: Exclude<SendStage, 'idle'>;
  target?: string;          // кому отправляем — показываем на шаге заливки
  icons: { file: React.ReactNode; send: React.ReactNode };
}> = ({ stage, target, icons }) => (
  <div className="py-4 text-center space-y-5">
    {stage === 'done' ? (
      <SuccessCheck />
    ) : (
      <div className="relative w-[72px] h-[72px] mx-auto flex items-center justify-center">
        <svg className="absolute inset-0 animate-spin" viewBox="0 0 60 60" fill="none">
          <circle cx="30" cy="30" r="26" className="stroke-emerald-100 dark:stroke-emerald-900/40" strokeWidth="3.5" />
          <circle
            cx="30" cy="30" r="26" className="stroke-emerald-500"
            strokeWidth="3.5" strokeLinecap="round"
            strokeDasharray="40 126" transform="rotate(-90 30 30)"
          />
        </svg>
        <span className="text-emerald-600 dark:text-emerald-400 animate-stage-pulse">
          {stage === 'pdf' ? icons.file : icons.send}
        </span>
      </div>
    )}

    <div key={stage} className="animate-stage-in">
      <h3 className="text-lg font-bold text-slate-800 dark:text-white">
        {stage === 'pdf' ? 'Готовим документ'
          : stage === 'upload' ? 'Отправляем клиенту'
          : 'Договор отправлен'}
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
        {stage === 'pdf' ? 'Формируем PDF договора'
          : stage === 'upload' ? (target || 'Загружаем файл в WhatsApp')
          : 'Клиент получит его в WhatsApp'}
      </p>
    </div>

    {stage !== 'done' && (
      <div className="flex items-center justify-center gap-2">
        {(['pdf', 'upload'] as const).map(step => (
          <span
            key={step}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              stage === step ? 'w-7 bg-emerald-500'
                : step === 'pdf' ? 'w-1.5 bg-emerald-500'
                : 'w-1.5 bg-slate-200 dark:bg-slate-600'
            }`}
          />
        ))}
      </div>
    )}
  </div>
);
