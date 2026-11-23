// Разбор свободного ввода: «такси 12 долларов», «зарплата 2400», «кофе 250». Работает локально.

const CURRENCY_WORDS = [
  [/(доллар|бакс|usd|\$)/i, 'USD'],
  [/(евро|eur|€)/i, 'EUR'],
  [/(руб|rub|₽)/i, 'RUB'],
  [/(грив|грн|uah|₴)/i, 'UAH'],
  [/(тенге|kzt|₸)/i, 'KZT'],
  [/(лари|gel|₾)/i, 'GEL'],
  [/(злот|pln|zł)/i, 'PLN'],
  [/(фунт|gbp|£)/i, 'GBP'],
  [/(юан|cny|¥)/i, 'CNY'],
  [/(\bбат|thb|฿)/i, 'THB'],
  [/(дирхам|aed)/i, 'AED'],
  [/(\bлир|try\b|₺)/i, 'TRY'],
  [/(драм|amd|֏)/i, 'AMD'],
  [/(биткоин|битко|btc|₿)/i, 'BTC'],
  [/(эфир|ethereum|\beth\b)/i, 'ETH'],
  [/(usdt|тезер|тетер)/i, 'USDT'],
  [/(\bton\b|тон\b|toncoin)/i, 'TON'],
];

const INCOME_RE = /(зарплат|получил|получила|пришл|доход|аванс|кэшбэк|кешбек|вернули|продал|премия|гонорар|фриланс)/i;

/** Ключевые слова → название ярлыка по умолчанию. */
const KEYWORDS = [
  ['Такси', /(такси|uber|убер|яндекс го|bolt|болт|lyft|careem|indrive|индрайв)/i],
  ['Транспорт', /(метро|автобус|трамва|электрич|проезд|бензин|топливо|заправ|азс|парков|каршер|транспорт|shell|wog|окко|лукойл)/i],
  ['Продукты', /(продукт|магазин|супермаркет|пятёроч|пятероч|магнит|перекрест|ашан|лента|вкусвилл|сильпо|атб|novus|lidl|aldi|carrefour|spar|auchan|walmart|grocery|market|рынок|хлеб|молоко|овощ)/i],
  ['Кафе', /(кафе|кофе|ресторан|бар\b|обед|ужин|завтрак|пицц|суши|бургер|шаурм|starbucks|mcdonald|макдон|kfc|доставк|glovo|wolt|deliveroo|ед[аы]\b)/i],
  ['Подписки', /(подписк|netflix|spotify|youtube|apple|icloud|claude|chatgpt|openai|anthropic|google one|яндекс плюс|кинопоиск|notion|figma|adobe|github|patreon)/i],
  ['Связь', /(связь|мобильн|телефон|интернет|vodafone|kyivstar|киевстар|мтс|билайн|мегафон|теле2|lifecell|tele2)/i],
  ['Дом', /(аренд|квартир|коммунал|жкх|свет\b|электричеств|газ\b|вода\b|ремонт|мебел|ikea|икеа|леруа|epicentr)/i],
  ['Здоровье', /(аптек|лекарств|врач|клиник|стомат|анализ|больниц|спортзал|фитнес|gym|массаж)/i],
  ['Покупки', /(одежд|обув|покупк|amazon|aliexpress|алиэкспресс|ozon|озон|wildberries|вайлдберр|rozetka|розетк|zara|h&m|uniqlo|техник|электроник)/i],
  ['Развлечения', /(кино|театр|концерт|игр[аы]|steam|playstation|xbox|клуб|боулинг|музей|билет)/i],
  ['Подарки', /(подар|цвет[ыо]|букет)/i],
  ['Кредиты', /(кредит|ипотек|рассрочк|займ)/i],
  ['Комиссии', /(комисси|fee\b)/i],
  ['Зарплата', /(зарплат|аванс|salary|payroll|премия)/i],
  ['Подработка', /(фриланс|подработ|гонорар|upwork|fiverr)/i],
];

const UNITS = { ноль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19 };
const TENS = { двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90 };
const HUNDREDS = { сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900 };

/** «двести пятьдесят» → 250, «полторы тысячи» → 1500. Возвращает { value, words } или null. */
function wordsToNumber(words) {
  let total = 0, cur = 0, used = [], found = false;
  for (const w of words) {
    if (w === 'полторы' || w === 'полтора') { cur += 1.5; used.push(w); found = true; continue; }
    if (UNITS[w] != null) { cur += UNITS[w]; used.push(w); found = true; continue; }
    if (TENS[w] != null) { cur += TENS[w]; used.push(w); found = true; continue; }
    if (HUNDREDS[w] != null) { cur += HUNDREDS[w]; used.push(w); found = true; continue; }
    if (/^тысяч/.test(w)) { total += (cur || 1) * 1000; cur = 0; used.push(w); found = true; continue; }
    if (found) break;
  }
  return found ? { value: total + cur, words: used } : null;
}

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Разобрать фразу.
 * @returns {{type:'expense'|'income', amount:number|null, currency:string|null, note:string}}
 */
export function parseQuick(text) {
  let s = ` ${String(text || '').trim()} `;
  let amount = null;

  // цифры: «1 200,50», «12.5», «3к», «2 тыс»
  const m = s.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(k|к|тыс\w*)?(?=[^\d]|$)/i);
  if (m) {
    amount = Number(m[1].replace(/\s/g, '').replace(',', '.'));
    if (m[2]) amount *= 1000;
    s = s.replace(m[0], ' ');
  } else {
    const words = norm(s).split(' ');
    for (let i = 0; i < words.length; i++) {
      const r = wordsToNumber(words.slice(i));
      if (r) {
        amount = r.value;
        for (const w of r.words) s = s.replace(new RegExp(`\\s${w}(?=\\s)`, 'i'), ' ');
        break;
      }
    }
  }

  let currency = null;
  for (const [re, code] of CURRENCY_WORDS) {
    const cm = s.match(new RegExp(`${re.source}[\\p{L}]*`, 'iu'));
    if (cm) { currency = code; s = s.replace(cm[0], ' '); break; }
  }

  const type = INCOME_RE.test(text) ? 'income' : 'expense';
  let note = s.replace(/\b(за|на|в|потратил|потратила|заплатил|заплатила|купил|купила|трата|расход)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  note = note.charAt(0).toUpperCase() + note.slice(1);
  return { type, amount: amount > 0 ? amount : null, currency, note };
}

/**
 * Подобрать ярлык: прошлые операции с похожим описанием → название ярлыка в тексте → словарь.
 * @param {string} text
 * @param {Array} categories [{id, name, type}]
 * @param {Array} history операции [{note, categoryId, type}]
 * @param {'expense'|'income'} type
 */
export function guessCategory(text, categories, history = [], type = 'expense') {
  const t = norm(text);
  if (!t) return null;
  const fits = (c) => c && (c.type === 'both' || c.type === type);
  // 1. история: самое частое совпадение по описанию
  const counts = new Map();
  for (const h of history) {
    if (!h.note || h.type !== type) continue;
    const n = norm(h.note);
    if (n && (n === t || (n.length > 3 && (t.includes(n) || n.includes(t))))) counts.set(h.categoryId, (counts.get(h.categoryId) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best && fits(categories.find((c) => c.id === best[0]))) return best[0];
  // 2. название ярлыка прямо в тексте
  for (const c of categories) {
    if (fits(c) && norm(c.name).length > 2 && t.includes(norm(c.name).slice(0, Math.max(4, norm(c.name).length - 2)))) return c.id;
  }
  // 3. словарь
  for (const [name, re] of KEYWORDS) {
    if (!re.test(text)) continue;
    const c = categories.find((x) => x.name === name);
    if (fits(c)) return c.id;
  }
  return null;
}
