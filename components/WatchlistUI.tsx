import React from 'react';
import type { WatchlistMatch } from '../src/watchlist';
export const wlCard = 'rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800';
export const wlInput = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
export const wlButton = 'rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed';
export const wlSecondary = 'rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition active:scale-[.98] disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100';
export const WatchlistError: React.FC<{ message: string | null }> = ({ message }) => message ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">{message}</p> : null;
export const WatchlistField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="block space-y-1.5"><span className="block text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>{children}</label>;
export function WatchlistGuarantors({ guarantors }: { guarantors: WatchlistMatch['guarantors'] }) {
  if (!guarantors?.length) return null;
  return <div className="space-y-0.5 border-t border-current/10 pt-1.5 text-sm">
    <p className="text-xs font-medium opacity-80">{guarantors.length === 1 ? 'Поручитель' : 'Поручители'}</p>
    {guarantors.map(guarantor => <p key={guarantor.id} className="break-words">{guarantor.name}</p>)}
  </div>;
}
export const WatchlistRules: React.FC<{ compact?: boolean }> = ({ compact = false }) => <div className="space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
  <p>В общем поиске допущенные пользователи FinUchet увидят ФИО и причину. Если известен год рождения, он также отображается. В записях, добавленных администратором, может отображаться полная дата рождения, если она включена в публикацию. {!compact && 'Для «Другой причины» показывается её описание вместо названия категории. '}Обычная база клиентов остаётся закрытой.</p>
  <p>Добавляйте только собственных клиентов, при наличии подтверждённого законного основания для передачи. Принятие этих правил не заменяет согласия клиента.{!compact && ' Администратор выбирает режим: публикация с его одобрением или автоматическая публикация новых заявок.'}</p>
  <p>Причина указана со слов автора записи. В описание не включайте паспортные данные, контакты, адреса и суммы долга. Сведения об основании, служебные комментарии и решения доступны только автору и администратору.</p>
  <p>Поиск по полному ФИО и необязательному году показывает возможные совпадения. Тёзки могут быть разными людьми, отсутствие записи не подтверждает платёжеспособность. Решение о договоре принимаете вы.</p>
  <p>Сканирование заполняет ФИО и год для проверки. При его запуске изображение передаётся действующему сервису распознавания; фото и номер паспорта в общем списке не сохраняются.</p>
  {!compact && <>
    <p>Срок публикации выбирает администратор: до удаления или на ограниченный срок. В режиме «До удаления» запись не исчезает автоматически через 90 дней. Свою публикацию можно отозвать в любое время; ошибку — обжаловать. Не копируйте общий список и не передавайте сведения посторонним.</p>
    <p>Обращения клиентов, в том числе без аккаунта: <a href="mailto:rassrochkru@gmail.com?subject=Обращение%20по%20общему%20списку" className="text-indigo-600 underline dark:text-indigo-300">rassrochkru@gmail.com</a>. Укажите суть обращения и идентификатор записи, если он известен. Не прикладывайте паспорт к первому письму.</p>
  </>}
</div>;
