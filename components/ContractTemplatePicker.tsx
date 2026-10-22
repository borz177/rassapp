import React, { lazy, Suspense, useState, useMemo } from "react";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import type { CustomContractTemplate } from "../types";
import { appConfirm } from "../src/dialogs";
import Sheet from "./Sheet";
import ContractPreviewFrame from "./ContractPreviewFrame";
import {
  CONTRACT_TEMPLATES,
  PAID_CONTRACT_TEMPLATES,
  blankContractData,
  buildContractHtml,
  sampleContractData,
  type ContractTemplateId,
} from "../src/contractTemplates";
import { openPrintPreview } from "./PrintPreview";
import { contractPdfBlob, saveContractPdf } from "../src/contractPdf";
const CustomContractTemplateEditor = lazy(
  () => import("./CustomContractTemplateEditor"),
);

interface ContractTemplatePickerProps {
  value: ContractTemplateId;
  companyName: string;
  sellerPhone: string;
  onChange: (id: ContractTemplateId) => void;
  /** Открыт ли доступ к платным формам — со «Стандарта» и выше */
  allowPaid?: boolean;
  customTemplates?: CustomContractTemplate[];
  canManage?: boolean;
  onCustomTemplatesChange?: (
    templates: CustomContractTemplate[],
    selected: ContractTemplateId,
  ) => void | Promise<void>;
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
  value,
  companyName,
  sellerPhone,
  onChange,
  allowPaid = true,
  customTemplates = [],
  canManage = false,
  onCustomTemplatesChange,
}) => {
  const [preview, setPreview] = useState<ContractTemplateId | null>(null);
  const [blankBusy, setBlankBusy] = useState(false);
  const [blankError, setBlankError] = useState<string | null>(null);
  const [editor, setEditor] = useState<CustomContractTemplate | "new" | null>(
    null,
  );
  const [libraryError, setLibraryError] = useState("");
  const remove = async (template: CustomContractTemplate) => {
    if (
      !(await appConfirm(
        `Удалить шаблон «${template.name}»? Формы уже оформленных договоров сохранятся.`,
      ))
    )
      return;
    try {
      await onCustomTemplatesChange?.(
        customTemplates.filter((t) => t.id !== template.id),
        value === `CUSTOM:${template.id}` ? "MODERN" : value,
      );
    } catch {
      setLibraryError("Не удалось удалить шаблон. Попробуйте ещё раз.");
    }
  };

  /**
   * Пустой бланк выбранной формы в PDF. Собираем тем же кодом, что и настоящий
   * договор: бланк, свёрстанный отдельно, разошёлся бы с ним на первой правке.
   *
   * Если PDF собрать не вышло (старый кеш приложения после обновления — браузер
   * отдаёт HTML вместо куска кода), бланк всё равно попадает к человеку: открываем
   * окно печати, откуда он уходит на бумагу или в «Сохранить как PDF».
   */
  const downloadBlank = async () => {
    if (blankBusy) return;
    setBlankBusy(true);
    setBlankError(null);
    const data = {
      ...blankContractData(companyName, sellerPhone),
      customTemplate: customTemplates.find((t) => value === `CUSTOM:${t.id}`),
    };
    try {
      const title = `Бланк договора${companyName ? ` — ${companyName}` : ""}`;
      const blob = await contractPdfBlob(value, data, title);
      await saveContractPdf(blob, `${title}.pdf`);
    } catch (err) {
      console.error("Бланк договора:", err);
      setBlankError("PDF собрать не удалось — открыли бланк для печати");
      openPrintPreview(buildContractHtml(value, data), {
        title: "Бланк договора",
      });
    } finally {
      setBlankBusy(false);
    }
  };

  const previewData = useMemo(
    () => ({
      ...sampleContractData(
        companyName,
        sellerPhone,
        customTemplates.find((t) => preview === `CUSTOM:${t.id}`),
      ),
      customTemplate: customTemplates.find((t) => preview === `CUSTOM:${t.id}`),
    }),
    [preview, companyName, sellerPhone, customTemplates],
  );

  return (
    <div className="space-y-3">
      {CONTRACT_TEMPLATES.map((t) => {
        const locked = !allowPaid && PAID_CONTRACT_TEMPLATES.includes(t.id);
        const active = value === t.id && !locked;
        return (
          <div
            key={t.id}
            className={`rounded-2xl border-2 p-4 transition-all ${
              active
                ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40"
                : "border-slate-100 dark:border-slate-700"
            }`}
          >
            <button
              onClick={() => !locked && onChange(t.id)}
              disabled={locked}
              className={`w-full text-left flex items-start gap-3 ${locked ? "cursor-not-allowed" : ""}`}
            >
              <span
                className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                  active
                    ? "border-indigo-600"
                    : "border-slate-300 dark:border-slate-600"
                } ${locked ? "opacity-40" : ""}`}
              >
                {active && (
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-slate-800 dark:text-white">
                  {t.name}
                  {t.id === "MODERN" && (
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
                <span className="block text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.description}
                </span>
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

      <div className="pt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-bold text-slate-800 dark:text-white">
              Мои шаблоны
            </p>
          </div>
          <span className="text-xs text-slate-400">
            {customTemplates.length} / 10
          </span>
        </div>
        {customTemplates.map((t) => {
          const id = `CUSTOM:${t.id}` as ContractTemplateId;
          const active = value === id && allowPaid;
          return (
            <div
              key={t.id}
              className={`rounded-2xl border-2 p-4 ${active ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-100 dark:border-slate-700"}`}
            >
              <button
                type="button"
                disabled={!allowPaid}
                onClick={() => onChange(id)}
                className="w-full text-left flex gap-3 items-center disabled:opacity-50"
              >
                <span
                  className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${active ? "border-indigo-600" : "border-slate-300 dark:border-slate-600"}`}
                >
                  {active && (
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-bold text-slate-800 dark:text-white block truncate">
                    {t.name}
                  </span>
                  {active && (
                    <span className="text-xs text-slate-500">По умолчанию</span>
                  )}
                </span>
                <FileText size={20} className="text-indigo-500 shrink-0" />
              </button>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setPreview(id)}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-slate-600 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300"
                >
                  Образец
                </button>
                {canManage && allowPaid && (
                  <>
                    <button
                      type="button"
                      aria-label={`Изменить ${t.name}`}
                      onClick={() => setEditor(t)}
                      className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500"
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Удалить ${t.name}`}
                      onClick={() => remove(t)}
                      className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-rose-600"
                    >
                      <Trash2 size={17} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {canManage && (
          <button
            type="button"
            disabled={!allowPaid || customTemplates.length >= 10}
            onClick={() => setEditor("new")}
            className="w-full flex justify-center items-center gap-2 rounded-2xl border-2 border-dashed border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 py-4 font-semibold text-sm disabled:opacity-40 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
          >
            <Plus size={18} />
            Добавить шаблон
          </button>
        )}
        {!allowPaid && (
          <p className="text-xs text-slate-500">
            Доступно с дополнительными шаблонами.
          </p>
        )}
        {libraryError && (
          <p role="alert" className="text-xs text-rose-600">
            {libraryError}
          </p>
        )}
      </div>
      {editor && (
        <Suspense
          fallback={
            <p role="status" className="text-sm text-slate-500">
              Открываем редактор…
            </p>
          }
        >
          <CustomContractTemplateEditor
            initial={editor === "new" ? undefined : editor}
            companyName={companyName}
            sellerPhone={sellerPhone}
            onClose={() => setEditor(null)}
            onSave={async (template) => {
              const previous = editor === "new" ? null : editor;
              const list = previous
                ? customTemplates.map((t) =>
                    t.id === previous.id ? template : t,
                  )
                : [...customTemplates, template];
              const selected =
                previous && value === `CUSTOM:${previous.id}`
                  ? (`CUSTOM:${template.id}` as ContractTemplateId)
                  : value;
              await onCustomTemplatesChange?.(list, selected);
            }}
          />
        </Suspense>
      )}

      {/* Пустой бланк — для тех, кто оформляет на руках: распечатал пачку и
          заполняешь ручкой. Подставлены только продавец и телефон. */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Пустой бланк (PDF)
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Выбранная форма с вашим названием и телефоном — остальное
              заполняется от руки.
            </p>
          </div>
          {/* Пока собирается снимок листа, кнопка занята: второе нажатие запустило бы
              вторую сборку и на телефоне отдало бы два одинаковых файла. */}
          <button
            type="button"
            onClick={downloadBlank}
            disabled={blankBusy}
            data-testid="download-blank"
            className="shrink-0 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold active:scale-95 transition-transform disabled:opacity-60 disabled:active:scale-100"
          >
            {blankBusy ? "Готовим…" : "Скачать"}
          </button>
        </div>
        {blankError && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {blankError}
          </p>
        )}
      </div>

      {preview && (
        <Sheet
          onClose={() => setPreview(null)}
          className="sm:max-w-3xl h-[88vh] sm:h-[85vh] flex flex-col overflow-hidden"
        >
          <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 shrink-0 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-bold text-slate-800 dark:text-white truncate">
                {CONTRACT_TEMPLATES.find((t) => t.id === preview)?.name ||
                  previewData.customTemplate?.name}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Образец с придуманными данными
              </p>
            </div>
            <button
              onClick={() => setPreview(null)}
              className="shrink-0 w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-bold"
            >
              ×
            </button>
          </div>

          {/* Белый фон под листом всегда: договор печатается на бумаге, и в
                  тёмной теме показывать его тёмным значило бы показывать не то,
                  что выйдет из принтера. */}
          <div className="flex-1 overflow-hidden bg-slate-200 dark:bg-slate-900 p-2 sm:p-4">
            <ContractPreviewFrame
              template={preview}
              data={previewData}
              title="Образец договора"
            />
          </div>

          <div className="p-4 border-t border-slate-100 dark:border-slate-700 shrink-0 flex gap-2">
            <button
              onClick={() => setPreview(null)}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm"
            >
              Закрыть
            </button>
            {value !== preview &&
              !(
                !allowPaid &&
                (PAID_CONTRACT_TEMPLATES.includes(preview) ||
                  preview.startsWith("CUSTOM:"))
              ) && (
                <button
                  onClick={() => {
                    onChange(preview);
                    setPreview(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm"
                >
                  Выбрать этот
                </button>
              )}
          </div>
        </Sheet>
      )}
    </div>
  );
};

export default ContractTemplatePicker;
