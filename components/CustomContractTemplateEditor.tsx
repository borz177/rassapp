import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Upload,
  Plus,
  Eye,
  AlertCircle,
  Check,
  X,
  LoaderCircle,
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  LayoutList,
} from "lucide-react";
import type { CustomContractTemplate, TemplateBlock } from "../types";
import GlassSheet, {
  SheetField,
  SheetSection,
  sheetInputClass,
} from "./GlassSheet";
import {
  TEMPLATE_FIELDS,
  COLUMN_TITLES,
  MAX_BLOCKS,
  starterLayout,
  normalizeBlock,
  layoutOf,
  layoutTokens,
  templateErrors,
} from "../shared/contractTemplate.js";
import { sampleContractData } from "../src/contractTemplates";
import { api } from "../services/api";
import { friendlyError } from "../src/friendlyError";
import { appConfirm } from "../src/dialogs";
import ContractPreviewFrame from "./ContractPreviewFrame";

const newId = () => `ct_${crypto.randomUUID().replace(/-/g, "")}`;
const FIELDS = TEMPLATE_FIELDS as Record<string, string>;

/** В полях ввода поле видно по названию — «[ФИО покупателя]», а хранится как {{customerName}} */
const toDisplay = (text: string) =>
  text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => (FIELDS[k] ? `[${FIELDS[k]}]` : m));
const fromDisplay = (text: string) =>
  text.replace(/\[([^\[\]]+)\]/g, (m, label) => {
    const key = Object.keys(FIELDS).find((k) => FIELDS[k] === label);
    return key ? `{{${key}}}` : m;
  });

const BLOCK_LABELS: Record<TemplateBlock["type"], string> = {
  title: "Заголовок",
  text: "Абзац",
  row: "Строка с полями",
  list: "Условия списком",
  schedule: "Таблица графика платежей",
  signatures: "Подписи",
  gap: "Отступ",
  pagebreak: "Новая страница",
};

const newBlock = (type: TemplateBlock["type"]): TemplateBlock =>
  normalizeBlock(
    type === "title"
      ? { type, text: "ДОГОВОР № {{contractNumber}}" }
      : type === "text"
        ? { type, text: "Текст" }
        : type === "row"
          ? { type, cells: [{ label: "Покупатель:", text: "{{customerName}}", width: 100, fill: true }] }
          : type === "list"
            ? { type, items: ["Первое условие", "Второе условие"] }
            : type === "schedule"
              ? { type, columns: ["number", "date", "paid", "remaining"].map((key) => ({ key, title: COLUMN_TITLES[key as keyof typeof COLUMN_TITLES], width: key === "number" ? 10 : 30 })), rows: 8 }
              : type === "signatures"
                ? { type, items: ["Продавец", "Покупатель"] }
                : { type, size: 2 },
  ) as TemplateBlock;

const chip =
  "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors";
const chipOn = "bg-indigo-600 text-white border-indigo-600";
const chipOff =
  "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600";
const box =
  "w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[16px] text-slate-900 dark:text-white outline-none focus:border-indigo-400";
const iconBtn =
  "p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30";

/** Поле ввода с кнопкой «+ поле»: вставляет данные договора по названию */
function FieldInput({
  value,
  onChange,
  multiline,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const shown = toDisplay(value);
  const insert = (key: string) => {
    const el = ref.current;
    const s = el?.selectionStart ?? shown.length;
    const e = el?.selectionEnd ?? s;
    const token = `[${FIELDS[key]}]`;
    onChange(fromDisplay(shown.slice(0, s) + token + shown.slice(e)));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + token.length, s + token.length);
    });
  };
  return (
    <div className="flex gap-1.5 items-start">
      {multiline ? (
        <textarea
          ref={ref as any}
          value={shown}
          rows={Math.min(8, Math.max(2, shown.split("\n").length + 1))}
          maxLength={3000}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(fromDisplay(e.target.value))}
          className={`${box} min-w-0 flex-1 resize-y`}
        />
      ) : (
        <input
          ref={ref}
          value={shown}
          maxLength={500}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(fromDisplay(e.target.value))}
          className={`${box} min-w-0 flex-1`}
        />
      )}
      <select
        value=""
        disabled={disabled}
        aria-label="Вставить поле"
        onChange={(e) => e.target.value && insert(e.target.value)}
        className="shrink-0 w-[88px] rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold px-1.5 py-2"
      >
        <option value="">+ поле</option>
        {Object.entries(FIELDS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

const Seg = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((o) => (
      <button
        key={o.id}
        type="button"
        onClick={() => onChange(o.id)}
        className={`${chip} ${value === o.id ? chipOn : chipOff}`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="block text-[11px] font-medium text-slate-400 mb-1">{children}</span>
);

/** Редактор одного блока */
function BlockForm({
  block,
  onChange,
  disabled,
}: {
  block: TemplateBlock;
  onChange: (b: TemplateBlock) => void;
  disabled?: boolean;
}) {
  const set = (p: any) => onChange({ ...block, ...p } as TemplateBlock);
  if (block.type === "title" || block.type === "text")
    return (
      <div className="space-y-2.5">
        <FieldInput multiline value={block.text} disabled={disabled} onChange={(text) => set({ text })} />
        <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
          <Seg
            value={block.align}
            onChange={(align) => set({ align })}
            options={[
              { id: "left", label: "Слева" },
              { id: "center", label: "По центру" },
              { id: "right", label: "Справа" },
              { id: "justify", label: "По ширине" },
            ]}
          />
          <div className="flex gap-1.5">
            <button type="button" onClick={() => set({ bold: !block.bold })} className={`${chip} font-bold ${block.bold ? chipOn : chipOff}`}>Ж</button>
            <button type="button" onClick={() => set({ italic: !block.italic })} className={`${chip} italic ${block.italic ? chipOn : chipOff}`}>К</button>
          </div>
          <Seg
            value={block.size}
            onChange={(size) => set({ size })}
            options={[
              { id: "small", label: "Мелко" },
              { id: "normal", label: "Обычно" },
              { id: "large", label: "Крупно" },
            ]}
          />
        </div>
      </div>
    );
  if (block.type === "row")
    return (
      <div className="space-y-2.5">
        {block.cells.map((c, i) => {
          const setCell = (p: any) => set({ cells: block.cells.map((x, j) => (j === i ? { ...x, ...p } : x)) });
          return (
            <div key={i} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Ячейка {i + 1}</span>
                {block.cells.length > 1 && (
                  <button type="button" aria-label="Убрать ячейку" className={iconBtn} onClick={() => set({ cells: block.cells.filter((_, j) => j !== i) })}>
                    <X size={15} />
                  </button>
                )}
              </div>
              <div>
                <Label>Подпись</Label>
                <FieldInput value={c.label} disabled={disabled} placeholder="Например: Покупатель:" onChange={(label) => setCell({ label })} />
              </div>
              <div>
                <Label>Значение</Label>
                <FieldInput value={c.text} disabled={disabled} placeholder="Вставьте поле кнопкой справа" onChange={(text) => setCell({ text })} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  Ширина
                  <input
                    type="number"
                    min={10}
                    max={100}
                    step={5}
                    value={c.width}
                    onChange={(e) => setCell({ width: Math.min(100, Math.max(10, Number(e.target.value) || 50)) })}
                    className="w-16 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-[16px]"
                  />
                  %
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={c.fill} onChange={(e) => setCell({ fill: e.target.checked })} className="accent-indigo-600" />
                  Линия для записи, если пусто
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={c.bold} onChange={(e) => setCell({ bold: e.target.checked })} className="accent-indigo-600" />
                  Жирным
                </label>
              </div>
            </div>
          );
        })}
        {block.cells.length < 4 && (
          <button
            type="button"
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1"
            onClick={() => set({ cells: [...block.cells, { label: "", text: "", width: 50, fill: true, bold: false, align: "left" }] })}
          >
            <Plus size={14} />
            Ещё ячейка в строке
          </button>
        )}
      </div>
    );
  if (block.type === "list" || block.type === "signatures") {
    const unit = block.type === "list" ? "Пункт" : "Подпись";
    const max = block.type === "list" ? 60 : 4;
    return (
      <div className="space-y-2">
        {block.items.map((t, i) => (
          <div key={i} className="flex gap-1.5 items-start">
            <span className="w-5 pt-2 text-xs text-slate-400 text-right shrink-0">{block.type === "list" ? `${i + 1}.` : ""}</span>
            <div className="flex-1 min-w-0">
              <FieldInput multiline={block.type === "list"} value={t} disabled={disabled} placeholder={unit} onChange={(v) => set({ items: block.items.map((x, j) => (j === i ? v : x)) })} />
            </div>
            <button type="button" aria-label={`Убрать: ${unit}`} className={iconBtn} disabled={block.items.length < 2} onClick={() => set({ items: block.items.filter((_, j) => j !== i) })}>
              <X size={15} />
            </button>
          </div>
        ))}
        {block.items.length < max && (
          <button type="button" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1" onClick={() => set({ items: [...block.items, ""] })}>
            <Plus size={14} />
            {block.type === "list" ? "Ещё пункт" : "Ещё подпись"}
          </button>
        )}
        {block.type === "list" && (
          <Seg
            value={block.size}
            onChange={(size) => set({ size })}
            options={[
              { id: "small", label: "Мелко" },
              { id: "normal", label: "Обычно" },
              { id: "large", label: "Крупно" },
            ]}
          />
        )}
      </div>
    );
  }
  if (block.type === "schedule")
    return (
      <div className="space-y-2.5">
        {block.columns.map((c, i) => {
          const setCol = (p: any) => set({ columns: block.columns.map((x, j) => (j === i ? { ...x, ...p } : x)) });
          const move = (d: number) => {
            const cols = [...block.columns];
            [cols[i], cols[i + d]] = [cols[i + d], cols[i]];
            set({ columns: cols });
          };
          return (
            <div key={i} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Столбец {i + 1}</span>
                <div className="flex">
                  <button type="button" aria-label="Левее" className={iconBtn} disabled={i === 0} onClick={() => move(-1)}><ChevronUp size={15} className="-rotate-90" /></button>
                  <button type="button" aria-label="Правее" className={iconBtn} disabled={i === block.columns.length - 1} onClick={() => move(1)}><ChevronDown size={15} className="-rotate-90" /></button>
                  <button type="button" aria-label="Убрать столбец" className={iconBtn} disabled={block.columns.length < 2} onClick={() => set({ columns: block.columns.filter((_, j) => j !== i) })}><X size={15} /></button>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={c.key}
                  onChange={(e) => setCol({ key: e.target.value, title: c.title || COLUMN_TITLES[e.target.value as keyof typeof COLUMN_TITLES] })}
                  className={box}
                >
                  <option value="number">Номер платежа</option>
                  <option value="date">Дата платежа</option>
                  <option value="paid">Сумма платежа</option>
                  <option value="remaining">Остаток долга</option>
                  <option value="signature">Подпись (пусто)</option>
                  <option value="blank">Пустой столбец</option>
                </select>
                <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <input type="number" min={5} max={90} step={5} value={c.width} onChange={(e) => setCol({ width: Math.min(90, Math.max(5, Number(e.target.value) || 20)) })} className="w-16 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-[16px]" />
                  %
                </label>
              </div>
              <input value={c.title} maxLength={60} placeholder="Заголовок столбца" onChange={(e) => setCol({ title: e.target.value })} className={box} />
            </div>
          );
        })}
        {block.columns.length < 6 && (
          <button type="button" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1" onClick={() => set({ columns: [...block.columns, { key: "blank", title: "", width: 20 }] })}>
            <Plus size={14} />
            Ещё столбец
          </button>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          Пустых строк в бланке
          <input type="number" min={0} max={40} value={block.rows} onChange={(e) => set({ rows: Math.min(40, Math.max(0, Number(e.target.value) || 0)) })} className="w-16 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-[16px]" />
        </label>
      </div>
    );
  if (block.type === "gap")
    return (
      <Seg
        value={String(block.size) as any}
        onChange={(size) => set({ size: Number(size) })}
        options={[1, 2, 3, 4, 6].map((n) => ({ id: String(n) as any, label: n === 1 ? "Малый" : n === 2 ? "Средний" : n === 3 ? "Большой" : n === 4 ? "Очень большой" : "Огромный" }))}
      />
    );
  return <p className="text-xs text-slate-500">С нового листа</p>;
}

const summary = (b: TemplateBlock) => {
  const clip = (s: string) => toDisplay(s).replace(/\s+/g, " ").slice(0, 48);
  if (b.type === "title" || b.type === "text") return clip(b.text);
  if (b.type === "row") return clip(b.cells.map((c) => `${c.label} ${c.text}`).join(" · "));
  if (b.type === "list") return `${b.items.length} пункт.: ${clip(b.items[0] || "")}`;
  if (b.type === "schedule") return b.columns.map((c) => c.title || "—").join(" | ");
  if (b.type === "signatures") return b.items.join(", ");
  return "";
};

export default function CustomContractTemplateEditor({
  initial,
  companyName,
  sellerPhone,
  onSave,
  onClose,
}: {
  initial?: CustomContractTemplate;
  companyName: string;
  sellerPhone: string;
  onSave: (template: CustomContractTemplate) => void | Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CustomContractTemplate>(() =>
    initial
      ? { ...initial, layout: layoutOf(initial), id: newId(), createdAt: new Date().toISOString() }
      : {
          id: newId(),
          name: "Мой договор",
          fontSize: 12,
          fontFamily: "serif",
          createdAt: new Date().toISOString(),
          layout: starterLayout(),
        },
  );
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const baseline = useRef(JSON.stringify(draft));
  useEffect(() => () => abort.current?.abort(), []);
  const blocks = draft.layout.blocks;
  const errors = useMemo(() => templateErrors(draft), [draft]);
  const tokens = useMemo(() => layoutTokens(layoutOf(draft)), [draft]);
  const previewData = useMemo(
    () => ({ ...sampleContractData(companyName, sellerPhone, draft), customTemplate: draft }),
    [draft, companyName, sellerPhone],
  );
  const patch = (p: Partial<CustomContractTemplate>) => setDraft((d) => ({ ...d, ...p }));
  const setBlocks = (next: TemplateBlock[]) => patch({ layout: { blocks: next } });
  const updateAt = (i: number, b: TemplateBlock) => setBlocks(blocks.map((x, j) => (j === i ? b : x)));
  const moveAt = (i: number, d: number) => {
    const next = [...blocks];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setBlocks(next);
    setOpen(i + d);
  };
  const insertAt = (index: number, type: TemplateBlock["type"]) => {
    if (blocks.length >= MAX_BLOCKS) return;
    setBlocks([...blocks.slice(0, index), newBlock(type), ...blocks.slice(index)]);
    setOpen(index);
    setAdding(null);
  };

  const pickFiles = (picked: File[]) => {
    setError("");
    if (
      picked.length > 8 ||
      picked.some((f) => f.size > 8 * 1024 * 1024) ||
      picked.reduce((n, f) => n + f.size, 0) > 16 * 1024 * 1024
    ) {
      setError("Можно загрузить до 8 файлов: каждый до 8 МБ, вместе до 16 МБ.");
      return;
    }
    setFiles(picked);
    setConsent(false);
  };
  const recognize = async () => {
    if (busy || !files.length || !consent) return;
    if (
      JSON.stringify(draft) !== baseline.current &&
      !(await appConfirm("Заменить содержимое шаблона результатом распознавания? Текущие правки не сохранятся."))
    )
      return;
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const result = await api.recognizeContractTemplate(files, abort.current.signal);
      patch({
        name: result.name || draft.name,
        fontFamily: result.fontFamily,
        fontSize: result.fontSize,
        layout: result.layout,
      });
      setWarnings(result.warnings || []);
      setOpen(null);
      setTab("preview");
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(friendlyError(e, "Не удалось распознать образец."));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };
  const save = async (close: () => void) => {
    if (errors.length || saving || busy) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ ...draft, layout: layoutOf(draft) });
      baseline.current = JSON.stringify(draft);
      close();
    } catch (e) {
      setError(friendlyError(e, "Не удалось сохранить шаблон."));
    } finally {
      setSaving(false);
    }
  };

  const AddBlock = ({ index }: { index: number }) =>
    adding === index ? (
      <div className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-indigo-200 dark:ring-indigo-800 p-2 grid grid-cols-2 gap-1.5">
        {(Object.keys(BLOCK_LABELS) as TemplateBlock["type"][]).map((t) => (
          <button key={t} type="button" onClick={() => insertAt(index, t)} className="text-left rounded-xl px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
            <span className="block text-sm font-semibold text-slate-800 dark:text-white">{BLOCK_LABELS[t]}</span>
          </button>
        ))}
        <button type="button" onClick={() => setAdding(null)} className="col-span-2 text-xs text-slate-400 py-1">Отмена</button>
      </div>
    ) : (
      <button
        type="button"
        disabled={busy || blocks.length >= MAX_BLOCKS}
        onClick={() => setAdding(index)}
        className="w-full rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-semibold text-indigo-600 dark:text-indigo-400 py-2 flex items-center justify-center gap-1 disabled:opacity-40"
      >
        <Plus size={14} />
        Добавить блок
      </button>
    );

  return (
    <GlassSheet
      title={initial ? "Новая версия шаблона" : "Личный шаблон"}
      onClose={onClose}
      action={{
        label: saving ? "Сохраняем…" : "Сохранить",
        disabled: !!errors.length || busy || saving,
        submit: true,
      }}
      onSubmit={save}
      confirmClose={() =>
        busy
          ? appConfirm("Остановить обработку и закрыть редактор?")
          : JSON.stringify(draft) === baseline.current || appConfirm("Закрыть без сохранения изменений?")
      }
    >
      <div className="space-y-5 px-3 py-5 sm:px-5">
        <SheetSection title="Образец">
          <div className="p-4 space-y-3">
            <input
              ref={input}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf,.docx"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                pickFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              className="w-full rounded-2xl border-2 border-dashed border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 px-4 py-4 text-left flex gap-3 items-center hover:border-indigo-400 transition-colors disabled:opacity-50"
            >
              <span className="rounded-xl bg-white dark:bg-slate-800 p-2.5 text-indigo-600">
                <Upload size={22} />
              </span>
              <span>
                <span className="block font-semibold text-slate-800 dark:text-white">
                  {files.length ? "Изменить файлы" : "Добавить фото или документ"}
                </span>
                <span className="block text-xs text-slate-500 mt-1">Фото, PDF или Word</span>
              </span>
            </button>
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-500">
                    <FileText size={14} />
                    <span className="truncate flex-1">{i + 1}. {f.name}</span>
                    <span>{(f.size / 1024 / 1024).toFixed(1)} МБ</span>
                    {!busy && (
                      <button type="button" aria-label={`Убрать ${f.name}`} onClick={() => setFiles(files.filter((_, n) => n !== i))}>
                        <X size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {files.length > 0 && (
              <>
                <label className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-indigo-600" />
                  <span>Отправить образец на распознавание ИИ (лучше пустой бланк)</span>
                </label>
                <button
                  type="button"
                  onClick={busy ? () => abort.current?.abort() : recognize}
                  disabled={!busy && !consent}
                  className="w-full rounded-xl bg-indigo-600 text-white py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  {busy ? (
                    <>
                      <LoaderCircle size={17} className="animate-spin" />
                      Остановить
                    </>
                  ) : (
                    <>Распознать</>
                  )}
                </button>
              </>
            )}
            {busy && (
              <p role="status" className="text-xs text-slate-500">Читаем образец, до минуты…</p>
            )}
          </div>
        </SheetSection>
        {error && (
          <div role="alert" className="rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 p-3 text-sm flex gap-2">
            <AlertCircle size={18} className="shrink-0" />
            {error}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1">
            {warnings.map((w, i) => (
              <p key={i}>• {w}</p>
            ))}
          </div>
        )}
        <SheetSection title="Название и шрифт">
          <SheetField label="Название шаблона">
            <input value={draft.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} className={sheetInputClass} disabled={busy} />
          </SheetField>
          <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700">
            <SheetField label="Шрифт">
              <select value={draft.fontFamily} disabled={busy} onChange={(e) => patch({ fontFamily: e.target.value as "serif" | "sans" })} className={sheetInputClass}>
                <option value="serif">С засечками (Times)</option>
                <option value="sans">Без засечек (Arial)</option>
              </select>
            </SheetField>
            <SheetField label="Размер текста">
              <select value={draft.fontSize} disabled={busy} onChange={(e) => patch({ fontSize: Number(e.target.value) })} className={sheetInputClass}>
                {[10, 11, 12, 13, 14].map((n) => (
                  <option key={n} value={n}>{n} пт</option>
                ))}
              </select>
            </SheetField>
          </div>
        </SheetSection>
        <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 gap-1">
          {([
            { id: "edit", label: "Конструктор", icon: LayoutList },
            { id: "preview", label: "Предпросмотр", icon: Eye },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold flex justify-center gap-2 items-center ${tab === t.id ? "bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-300" : "text-slate-500"}`}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>
        {tab === "edit" ? (
          <div className="space-y-2.5">
            <AddBlock index={0} />
            {blocks.map((b, i) => (
              <React.Fragment key={i}>
                <div className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-slate-200/70 dark:ring-slate-700/70 overflow-hidden">
                  <div className="flex items-center gap-1 pr-1.5">
                    <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex-1 min-w-0 text-left px-3.5 py-2.5">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-indigo-500">{BLOCK_LABELS[b.type]}</span>
                      <span className="block text-sm text-slate-700 dark:text-slate-200 truncate">{summary(b) || "Пусто"}</span>
                    </button>
                    <button type="button" aria-label="Выше" className={iconBtn} disabled={i === 0 || busy} onClick={() => moveAt(i, -1)}><ChevronUp size={17} /></button>
                    <button type="button" aria-label="Ниже" className={iconBtn} disabled={i === blocks.length - 1 || busy} onClick={() => moveAt(i, 1)}><ChevronDown size={17} /></button>
                    <button type="button" aria-label="Дублировать" className={iconBtn} disabled={busy || blocks.length >= MAX_BLOCKS} onClick={() => { setBlocks([...blocks.slice(0, i + 1), JSON.parse(JSON.stringify(b)), ...blocks.slice(i + 1)]); setOpen(i + 1); }}><Copy size={16} /></button>
                    <button type="button" aria-label="Удалить блок" className={`${iconBtn} hover:text-rose-600`} disabled={busy} onClick={() => { setBlocks(blocks.filter((_, j) => j !== i)); setOpen(null); }}><Trash2 size={16} /></button>
                  </div>
                  {open === i && (
                    <div className="px-3.5 pb-3.5 pt-1 border-t border-slate-100 dark:border-slate-700/70">
                      <BlockForm block={b} disabled={busy} onChange={(nb) => updateAt(i, nb)} />
                    </div>
                  )}
                </div>
                <AddBlock index={i + 1} />
              </React.Fragment>
            ))}
            {!blocks.length && (
              <button type="button" onClick={() => setBlocks(starterLayout().blocks as TemplateBlock[])} className="w-full rounded-xl bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 text-sm font-semibold py-3">
                Начать с готового примера
              </button>
            )}
          </div>
        ) : (
          <div className="h-[65vh] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
            <ContractPreviewFrame template={`CUSTOM:${draft.id}`} data={previewData} title="Предпросмотр личного договора" />
          </div>
        )}
        <div className="rounded-xl bg-white dark:bg-slate-800 p-3 space-y-1.5">
          {errors.length ? (
            errors.map((e: string, i: number) => (
              <p key={i} className="text-xs text-amber-700 dark:text-amber-300">{e}</p>
            ))
          ) : (
            <p className="flex gap-2 items-center text-xs text-emerald-700 dark:text-emerald-400">
              <Check size={15} />
              Шаблон готов · {blocks.length} блоков · полей: {tokens.length}
            </p>
          )}
        </div>
      </div>
    </GlassSheet>
  );
}
