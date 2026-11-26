const { Parser } = require('htmlparser2');
const { isMainThread, parentPort, workerData } = require('node:worker_threads');
const MAX_MIB = 9;
const MAX_BYTES = MAX_MIB * 1024 * 1024;
const MAX_MESSAGES = 20000;
const MAX_TEXT = 12000;
const russianMonths = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function publicationDate(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const raw = value.trim();
  const local = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)(?:\s+UTC([+-]\d{2}:\d{2}))?$/u.exec(raw);
  const spelled = /^(\d{1,2})\s+([а-я]+)\s+(\d{4}),\s*(\d{2}:\d{2}(?::\d{2})?)(?:\s+UTC([+-]\d{2}:\d{2}))?$/iu.exec(raw);
  const month = spelled ? russianMonths.indexOf(spelled[2].toLowerCase()) + 1 : null;
  if (spelled && !month) return null;
  const displayDate = local || spelled;
  const iso = displayDate
    ? `${displayDate[3]}-${local ? local[2] : String(month).padStart(2, '0')}-${displayDate[1].padStart(2, '0')}T${displayDate[4]}${displayDate[5] || '+03:00'}`
    : raw;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/u.exec(iso);
  if (!parts) return null;
  const calendar = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
  if (calendar.toISOString().slice(0, 10) !== iso.slice(0, 10)) return null;
  const timestamp = Date.parse(parts[4] ? iso : iso + '+03:00');
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function telegramMessages(html, progress = () => {}) {
  const rows = [], stack = [];
  let item = null, rootDepth = 0, textDepth = 0, authorDepth = 0, replyDepth = 0, ignored = 0;
  let previousAuthor = '', position = 0;
  const append = value => {
    if (!item || !textDepth || ignored) return;
    const length = MAX_TEXT - item.text.length;
    item.text += value.slice(0, length);
    if (value.length > length) item.truncated = true;
  };
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (stack.length >= 256) throw Error('INVALID_HTML');
      const classes = (attrs.class || '').split(/\s+/u);
      const depth = stack.push(tag);
      if (['script','style','iframe','object','template','svg','math'].includes(tag) && !ignored) ignored = depth;
      if (ignored) return;
      if (!item && tag === 'div' && classes.includes('message') && classes.includes('default') && /^message[\d-]+$/u.test(attrs.id || '')) {
        item = { messageId: attrs.id.slice(7), text: '', publishedAt: null, truncated: false, position: ++position };
        if (classes.includes('joined') && previousAuthor) item.author = previousAuthor;
        rootDepth = depth;
      }
      if (!item) return;
      if (tag === 'div' && classes.includes('from_name') && !textDepth) {
        item.author = '';
        authorDepth = depth;
      }
      if (tag === 'div' && classes.includes('reply_to') && !textDepth) replyDepth = depth;
      if (tag === 'a' && replyDepth && !item.replyTo) {
        const target = /^#(?:go_to_)?message([\d-]+)$/u.exec(attrs.href || '');
        if (target) item.replyTo = target[1];
      }
      if (tag === 'div' && classes.includes('date') && classes.includes('details') && !item.publishedAt)
        item.publishedAt = publicationDate(attrs.title);
      if (tag === 'div' && classes.includes('text') && !textDepth) textDepth = depth;
      if (['br','p','li'].includes(tag)) append('\n');
    },
    ontext(value) {
      if (item && authorDepth && !ignored) item.author = (item.author + value).slice(0, 200);
      append(value);
    },
    onclosetag() {
      const depth = stack.length;
      if (depth === ignored) ignored = 0;
      if (depth === textDepth) textDepth = 0;
      if (depth === authorDepth) authorDepth = 0;
      if (depth === replyDepth) replyDepth = 0;
      if (item && depth === rootDepth) {
        previousAuthor = item.author?.trim() || '';
        if (previousAuthor) item.author = previousAuthor;
        else delete item.author;
        item.text = item.text.trim();
        if (item.text) rows.push(item);
        if (rows.length > MAX_MESSAGES) throw Error('TOO_MANY_MESSAGES');
        item = null;
      }
      stack.pop();
    },
  }, { decodeEntities: true });
  for (let i = 0; i < html.length; i += 128 * 1024) {
    parser.write(html.slice(i, i + 128 * 1024));
    progress(Math.min(85, Math.floor((i + 128 * 1024) * 85 / html.length)));
  }
  parser.end();
  if (!rows.length) throw Error('NO_MESSAGES');
  return rows;
}

if (!isMainThread && workerData?.telegramArchive) {
  try {
    parentPort.postMessage({ rows: telegramMessages(workerData.html, progress => parentPort.postMessage({ progress })) });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
}

module.exports = { telegramMessages, publicationDate, MAX_BYTES, MAX_MIB };
