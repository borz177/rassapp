import React, { useState } from 'react';
import ModalPortal from './ModalPortal';
import {
  CONTRACT_TEMPLATES, PAID_CONTRACT_TEMPLATES, buildContractHtml, sampleContractData,
  type ContractTemplateId,
} from '../src/contractTemplates';

interface ContractTemplatePickerProps {
  value: ContractTemplateId;
  companyName: string;
  sellerPhone: string;
  onChange: (id: ContractTemplateId) => void;
  /** Открыт ли доступ к платным формам — со «Стандарта» и выше */
  allowPaid?: boolean;
}

/**
 * Выбор печатной формы договора с образцом.
 *
 * Образец показываем в самом приложении, а не открываем новым окном: договор
 * выбирают с телефона, а всплывающие окна там чаще всего заблокированы — человек
 * нажал бы «Посмотреть» и не увидел ничего. iframe с готовой разметкой работает
 * везде одинаково и показывает ровно то, что уйдёт на печать.
 */
const ContractTemplatePicker: React.FC<ContractTemplatePickerProps> = ({
  value, companyName, sellerPhone, onChange, allowPaid = true,
}) => {
  const [preview, setPreview] = useState<ContractTemplateId | null>(null);

  const html = preview
    ? buildContractHtml(preview, sampleContractData(companyName, sellerPhone))
    : '';

  return (
    <div className="space-y-3">
      {CONTRACT_TEMPLATES.map(t => {
        const locked = !allowPaid && PAID_CONTRACT_TEMPLATES.includes(t.id);
        const active = value === t.id && !locked;
        return (
          <div
            key={t.id}
            className={`rounded-2xl border-2 p-4 transition-all ${
              active
                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                : 'border-slate-100 dark:border-slate-700'
            }`}
          >
            <button
              onClick={() => !locked && onChange(t.id)}
              disabled={locked}
              className={`w-full text-left flex items-start gap-3 ${locked ? 'cursor-not-allowed' : ''}`}
            >
              <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                active ? 'border-indigo-600' : 'border-slate-300 dark:border-slate-600'
              } ${locked ? 'opacity-40' : ''}`}>
                {active && <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />}
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-slate-800 dark:text-white">
                  {t.name}
                  {t.id === 'MODERN' && (
                    <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 align-middle">
                      по умолчанию
                    </span>
                  )}
                  {locked && (
                    <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 align-middle">
                      Стандарт
                    </span>
                  )}
                </span>
                <span className="block text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t.description}</span>
              </span>
            </button>
            {/* Образец открыт и на запертой форме: иначе непонятно, за что
                предлагают платить. Закрыт только выбор. */}
            <button
              onClick={() => setPreview(t.id)}
              className="mt-3 w-full py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-bold text-sm"
            >
              Посмотреть образец
            </button>
          </div>
        );
      })}

      {preview && (
        <ModalPortal onClose={() => setPreview(null)}>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setPreview(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl shadow-2xl h-[88vh] sm:h-[85vh] flex flex-col"
                 onClick={e => e.stopPropagation()}>
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 shrink-0 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-800 dark:text-white truncate">
                    {CONTRACT_TEMPLATES.find(t => t.id === preview)?.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Образец с придуманными данными</p>
                </div>
                <button onClick={() => setPreview(null)}
                        className="shrink-0 w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-bold">
                  ×
                </button>
              </div>

              {/* Белый фон под листом всегда: договор печатается на бумаге, и в
                  тёмной теме показывать его тёмным значило бы показывать не то,
                  что выйдет из принтера. */}
              <div className="flex-1 overflow-hidden bg-slate-200 dark:bg-slate-900 p-2 sm:p-4">
                <iframe
                  title="Образец договора"
                  srcDoc={html}
                  className="w-full h-full bg-white rounded-lg border-0 shadow-inner"
                />
              </div>

              <div className="p-4 border-t border-slate-100 dark:border-slate-700 shrink-0 flex gap-2">
                <button onClick={() => setPreview(null)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                  Закрыть
                </button>
                {value !== preview && !(!allowPaid && PAID_CONTRACT_TEMPLATES.includes(preview)) && (
                  <button onClick={() => { onChange(preview); setPreview(null); }}
                          className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm">
                    Выбрать этот
                  </button>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default ContractTemplatePicker;
