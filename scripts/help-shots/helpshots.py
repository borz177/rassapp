"""Снимки экранов для раздела «Обучение» (src/helpArticles.ts → public/guide/*.webp).

По проходу на статью: скрипт tour.cjs открывает приложение (Electron, экран
телефона 390×844), выполняет шаги — нажатия по тексту, ввод в поля, прокрутку —
и снимает экран, обводя красной рамкой то, куда нажимать.

Нужно: запущенные `npm run dev` (порт 3000) и локальный сервер с демо-данными,
файл $HELP_SHOTS_DIR/login.json ({token, user}) — вход в демо-аккаунт.
Запуск: python3 scripts/help-shots/helpshots.py [статья ...], затем
конвертация в webp (sharp из server/node_modules) — см. convert ниже.
"""
import json, os, subprocess, sys

S = os.environ.get('HELP_SHOTS_DIR', os.path.expanduser('~/.finuchet-help-shots'))
TOUR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tour.cjs')
APP = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = S + '/helpshots'
os.makedirs(OUT, exist_ok=True)

FAB = {"tap": [195, 770], "wait": 1100}
pick_client = lambda name: {"js": "(()=>{const c=[...document.querySelectorAll('button,[class*=cursor-pointer],li')].filter(e=>e.getClientRects().length && /%s/.test(e.textContent) && e.offsetHeight<160); if(!c.length) return 'no'; c[c.length-1].click(); return 'picked'})()" % name, "wait": 1300}
select_debt = {"js": "(()=>{const s=[...document.querySelectorAll('select')].find(x=>x.getClientRects().length && [...x.options].some(o=>/Выберите долг/.test(o.text))); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s, s.options[1].value); s.dispatchEvent(new Event('change',{bubbles:true})); return 'sel'})()", "wait": 1200}
set_amount = {"js": "(()=>{const lab=[...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent.trim()==='Сумма прихода'); const inp=lab.parentElement.querySelector('input'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(inp,'12000'); inp.dispatchEvent(new Event('input',{bubbles:true})); return inp.value})()", "wait": 800}
scroll_to = lambda text, block='center': {"js": "(()=>{const e=[...document.querySelectorAll('button,label,span,p,div')].filter(x=>x.getClientRects().length && x.children.length===0 && x.textContent.trim()===%s).pop(); if(!e) return 'no'; e.scrollIntoView({block:'%s'}); return 1})()" % (json.dumps(text, ensure_ascii=False), block), "wait": 800}
open_customer = {"js": "(()=>{const c=[...document.querySelectorAll('[class*=cursor-pointer],button')].find(e=>/Ахмадов Тимур/.test(e.textContent) && e.offsetHeight>40 && e.offsetHeight<200); c.click(); return 'open'})()", "wait": 1500}
open_first_sale = {"js": "(()=>{const c=[...document.querySelectorAll('[class*=cursor-pointer],button,[role=button]')].filter(e=>/₽/.test(e.textContent) && e.offsetHeight>50 && e.offsetHeight<320); c[0].click(); return 'sale'})()", "wait": 1600}
more = {"click": "Еще", "sel": "button,a", "wait": 1200}

ARTICLES = {
  'start': [
    more, {"click": "Настройки", "sel": "button,a", "wait": 1600, "hl": "Название компании", "shot": "start-1"},
    {"click": "Касса", "sel": "nav button,button", "wait": 1500, "hl": "Новый счет", "shot": "start-2"},
    {"click": "Главная", "sel": "button,a", "wait": 1200}, FAB, {"hl": "Оформить продажу", "wait": 300, "shot": "start-3"},
  ],
  'customer': [
    {"click": "Клиенты", "sel": "button,a", "wait": 1400, "hl": "+ Добавить", "shot": "customer-1"},
    {"click": "+ Добавить", "wait": 1500, "hl": "Сканировать паспорт", "shot": "customer-2"},
    {"hl": "Добавить", "sel": "button", "wait": 300, "shot": "customer-3"},
  ],
  'sale': [
    FAB, {"hl": "Оформить продажу", "wait": 300, "shot": "sale-1"},
    {"click": "Оформить продажу", "wait": 1500, "hl": "Выбрать клиента", "shot": "sale-2"},
    {"click": "Выбрать клиента", "wait": 1300}, pick_client('Ахмадов Тимур'),
    {"type": "iPhone 15 128 ГБ", "into": "Введите название товара", "wait": 500},
    {"type": "80000", "into": "Закуп"}, {"type": "30", "into": "Наценка"},
    {"type": "6", "into": "Срок"}, {"type": "10000", "into": "Первый взнос"},
    scroll_to('Цена в рассрочку', 'start'), {"js": "window.scrollBy(0,-90);[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+20 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.getClientRects().length).forEach(e=>e.scrollTop-=110);1", "wait": 600},
    {"hl": "Цена в рассрочку", "sel": "label,span,p,div", "wait": 300, "shot": "sale-3"},
    scroll_to('Оформить', 'center'), {"hl": "Оформить", "sel": "button", "wait": 300, "shot": "sale-4"},
  ],
  'payment': [
    {"hl": "Приход", "sel": "button", "wait": 400, "shot": "payment-1"},
    {"click": "Приход", "sel": "button", "wait": 1500},
    {"click": "Нажмите для выбора", "wait": 1200}, pick_client('Ахмадов Тимур'), select_debt,
    {"hlsel": "select", "wait": 300, "shot": "payment-2"},
    set_amount, scroll_to('Подтвердить приход', 'center'),
    {"hl": "Подтвердить приход", "sel": "button", "wait": 300, "shot": "payment-3"},
  ],
  'whatsapp': [
    more, {"click": "Настройки", "sel": "button,a", "wait": 1500},
    {"click": "Интеграции", "wait": 1800, "hl": "Подключить WhatsApp", "shot": "whatsapp-1"},
    {"click": "Клиенты", "sel": "button,a", "wait": 1300}, open_customer, {"click": "Рассрочки", "wait": 1200}, open_first_sale,
    {"hl": "WhatsApp", "sel": "button", "wait": 300, "shot": "whatsapp-2"},
  ],
  'investors': [
    more, {"click": "Инвесторы", "sel": "button,a", "wait": 1500, "hl": "Добавить", "shot": "investors-1"},
    {"click": "Добавить", "wait": 1500, "shot": "investors-2"},
    {"click": "Отмена", "wait": 900}, {"click": "Закрыть", "sel": "button", "wait": 900},
    {"js": "(()=>{const c=[...document.querySelectorAll('[class*=cursor-pointer],button')].find(e=>/Руслан Алиев/.test(e.textContent) && e.offsetHeight>40 && e.offsetHeight<200); c.click(); return 'open'})()", "wait": 1700},
    {"scroll": 700, "wait": 900}, {"hl": "К выплате", "sel": "div", "wait": 300, "shot": "investors-3"},
    {"click": "Главная", "sel": "button,a", "wait": 1300},
    {"click": "Расход", "sel": "button", "wait": 1500}, {"click": "Выплата инвестору", "sel": "button", "wait": 1200},
    {"js": "(()=>{const s=[...document.querySelectorAll('select')].find(x=>x.getClientRects().length && [...x.options].some(o=>/Руслан/.test(o.text))); if(!s) return 'nosel'; const o=[...s.options].find(o=>/Руслан/.test(o.text)); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,o.value); s.dispatchEvent(new Event('change',{bubbles:true})); return 'sel'})()", "wait": 1000},
    {"click": "Из Прибыли", "wait": 800},
    scroll_to('Источник списания', 'start'), {"js": "window.scrollBy(0,-120);[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+20 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.getClientRects().length).forEach(e=>e.scrollTop-=140);1", "wait": 600},
    {"hl": "Из Прибыли", "sel": "button", "wait": 300, "shot": "investors-4"},
    {"click": "Главная", "sel": "button,a", "wait": 1300},
    {"click": "Приход", "sel": "button", "wait": 1500}, {"hl": "Инвестор", "sel": "button", "wait": 300, "shot": "investors-5"},
  ],
  'employees': [
    more, {"click": "Сотрудники", "sel": "button,a", "wait": 1500},
    {"click": "Добавить", "wait": 1500, "shot": "employees-1"},
    {"scroll": 520, "wait": 800, "shot": "employees-2"},
  ],
  'warehouse': [
    FAB, {"hl": "Склад", "wait": 300, "shot": "warehouse-1"},
    {"click": "Склад", "wait": 1700, "hl": "+ Товар", "shot": "warehouse-2"},
  ],
  'reports': [
    more, {"click": "Отчеты", "sel": "button,a", "wait": 1800, "hl": "Месяц", "shot": "reports-1"},
    {"hl": "📥 CSV", "wait": 300, "shot": "reports-2"},
  ],
  # ── Снимки для «Частых вопросов» ──
  'faq-start': [
    more, {"click": "Настройки", "sel": "button,a", "wait": 1500},
    {"click": "Оформление", "wait": 900}, {"hl": "Оформление", "wait": 300, "shot": "faq-start-theme"},
  ],
  'faq-customer': [
    {"click": "Клиенты", "sel": "button,a", "wait": 1300}, open_customer,
    {"js": "(()=>{const card=[...document.querySelectorAll('div')].filter(d=>d.getClientRects().length && /Телефон/i.test(d.textContent) && /Адрес/i.test(d.textContent) && d.offsetHeight<760).pop(); const b=card && [...card.querySelectorAll('button')].find(x=>!x.textContent.trim()); if(!b) return 'no'; b.click(); return 'menu'})()", "wait": 900},
    {"hl": "Редактировать", "sel": "button", "wait": 300, "shot": "faq-customer-edit"},
    {"js": "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); document.body.click(); 1", "wait": 700},
    scroll_to('Документы', 'center'), {"hl": "Документы", "sel": "button", "wait": 300, "shot": "faq-customer-docs"},
  ],
  'faq-sale': [
    more, {"hl": "Договоры", "sel": "button", "wait": 300, "shot": "faq-sale-contracts"},
    {"click": "Договоры", "sel": "button", "wait": 1700},
    {"js": "(()=>{const b=[...document.querySelectorAll('button[aria-label=\"Меню\"]')].filter(x=>x.getClientRects().length)[0]; if(!b) return 'no'; b.click(); return 'menu'})()", "wait": 1000},
    {"hl": "Редактировать", "sel": "button", "wait": 300, "shot": "faq-sale-menu"},
    {"click": "Главная", "sel": "button,a", "wait": 1200}, FAB, {"click": "Оформить продажу", "wait": 1500},
    {"js": "(()=>{const b=document.querySelector('button[title=\"Выбрать со склада\"]'); if(!b) return 'no'; b.scrollIntoView({block:'center'}); return 1})()", "wait": 700},
    {"hlsel": "button[title=\"Выбрать со склада\"]", "wait": 300, "shot": "faq-sale-stock"},
  ],
  'faq-payment': [
    {"click": "Клиенты", "sel": "button,a", "wait": 1300}, open_customer, {"click": "Рассрочки", "wait": 1200}, open_first_sale,
    scroll_to('История поступлений', 'start'),
    {"hlsel": "tbody tr td:last-child", "wait": 300, "shot": "faq-payment-edit"},
    {"click": "Главная", "sel": "button,a", "wait": 1300},
    {"click": "Приход", "sel": "button", "wait": 1500}, {"click": "Нажмите для выбора", "wait": 1200}, pick_client('Ахмадов Тимур'), select_debt,
    scroll_to('Сумма прихода', 'start'),
    {"hl": "Скидка при полном погашении", "sel": "div", "wait": 300, "shot": "faq-payment-discount"},
  ],
  'faq-whatsapp': [
    more, {"click": "Договоры", "sel": "button", "wait": 1700},
    {"hl": "Напомнить", "sel": "button", "wait": 300, "shot": "faq-whatsapp-all"},
  ],
  'faq-investors': [
    more, {"click": "Инвесторы", "sel": "button,a", "wait": 1500},
    {"js": "(()=>{const c=[...document.querySelectorAll('[class*=cursor-pointer],button')].find(e=>/Руслан Алиев/.test(e.textContent) && e.offsetHeight>40 && e.offsetHeight<200); c.click(); return 'open'})()", "wait": 1700},
    {"scroll": 330, "wait": 800}, {"hl": "Состав пула", "sel": "div", "wait": 300, "shot": "faq-investors-pool"},
    {"scroll": 700, "wait": 800}, {"hl": "Расчёт выхода", "sel": "button", "wait": 300, "shot": "faq-investors-exit"},
    {"scroll": 0, "wait": 600}, {"click": "Все операции", "sel": "button", "wait": 1300}, {"hl": "Выплаты", "sel": "button", "wait": 300, "shot": "faq-investors-ops"},
  ],
  'faq-employees': [
    more, {"click": "Сотрудники", "sel": "button,a", "wait": 1500}, {"click": "Добавить", "wait": 1500},
    {"scroll": 99999, "wait": 900}, {"hl": "Процент", "sel": "label,div", "wait": 300, "shot": "faq-employees-percent"},
  ],
  'faq-warehouse': [
    FAB, {"click": "Склад", "wait": 1700},
    {"hlsel": "button[title*=\"Прайс-лист\"]", "wait": 300, "shot": "faq-warehouse-price"},
    {"click": "Операции", "sel": "button", "wait": 1300, "shot": "faq-warehouse-ops"},
  ],
  'faq-reports': [
    more, {"click": "Отчеты", "sel": "button,a", "wait": 1700},
    scroll_to('Поступления', 'center'), {"hl": "Поступления", "sel": "button,div", "wait": 300, "shot": "faq-reports-details"},
    more, {"click": "Настройки", "sel": "button,a", "wait": 1500}, {"click": "Работа с данными", "wait": 1000},
    scroll_to('Экспорт в Excel', 'center'), {"hl": "Экспорт в Excel", "sel": "button,div", "wait": 300, "shot": "faq-reports-excel"},
  ],
}

only = sys.argv[1:] or list(ARTICLES)
env = dict(os.environ, SCRATCH=S, OUT=OUT)
env.pop('ELECTRON_RUN_AS_NODE', None)
def split(steps):
    # Нажатие и подсветка в одном шаге — сначала дождаться экрана, потом рамка
    out = []
    for st in steps:
        if (st.get('hl') or st.get('hlsel')) and (st.get('click') or st.get('tap') or st.get('js')):
            act = {k: v for k, v in st.items() if k not in ('hl', 'hlsel', 'shot')}
            out.append(act)
            out.append({k: v for k, v in st.items() if k in ('hl', 'hlsel', 'shot')} | {'wait': 300, **({'sel': st['sel']} if 'sel' in st and st.get('hl') and st['hl'] != st.get('click') else {})})
        else:
            out.append(st)
    return out

for name in only:
    path = f'{S}/hs-{name}.json'
    json.dump(split(ARTICLES[name]), open(path, 'w'), ensure_ascii=False)
    r = subprocess.run(['./node_modules/.bin/electron', TOUR], cwd=APP,
                       env=dict(env, STEPS=path), capture_output=True, text=True, timeout=240)
    bad = [l for l in r.stdout.splitlines() if 'NO' in l or 'ERR' in l or "'no'" in l or l.endswith(' no')]
    shots = [l for l in r.stdout.splitlines() if l.startswith('shot')]
    print(name, 'shots:', len(shots), 'problems:', bad)


# Конвертация в webp для приложения (ширина 540, качество 74 — ~25 КБ на снимок)
CONVERT = r"""
const sharp = require('sharp'); const fs = require('fs');
const [src, dst] = process.argv.slice(1);
(async () => { for (const f of fs.readdirSync(src).filter(f => f.endsWith('.png')))
  await sharp(src + '/' + f).resize(540).webp({ quality: 74 }).toFile(dst + '/' + f.replace('.png', '.webp')); })();
"""
subprocess.run(['node', '-e', CONVERT, OUT, os.path.join(APP, 'public', 'guide')], cwd=os.path.join(APP, 'server'), check=True)
print('webp ->', os.path.join(APP, 'public', 'guide'))
