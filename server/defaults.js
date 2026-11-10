// Domyślna konfiguracja: grupy czasowe, instrumenty, ustawienia.

export const CURRENCIES = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

export const BASKETS = {
  SAFE: ['JPY', 'CHF', 'USD'],
  CORE: ['EUR', 'GBP'],
  CARRY: ['AUD', 'NZD', 'CAD'],
};

export const DEFAULT_GROUPS = [
  { key: 'tokyo', name: 'Asia – Tokyo', close_time: '15:30', timezone: 'Asia/Tokyo', delay_min: 20 },
  { key: 'hk', name: 'Asia – Hong Kong', close_time: '16:10', timezone: 'Asia/Hong_Kong', delay_min: 20 },
  { key: 'europe', name: 'Europe', close_time: '17:35', timezone: 'Europe/Berlin', delay_min: 20 },
  { key: 'us', name: 'US – stocks & indices', close_time: '16:00', timezone: 'America/New_York', delay_min: 20 },
  { key: 'ny17', name: 'New York 17:00 – FX & metals', close_time: '17:00', timezone: 'America/New_York', delay_min: 10 },
];

function fxPairs() {
  const out = [];
  for (let i = 0; i < CURRENCIES.length; i++) {
    for (let j = i + 1; j < CURRENCIES.length; j++) {
      const b = CURRENCIES[i], q = CURRENCIES[j];
      out.push({
        id: b + q, name: `${b}/${q}`, class: 'fx', category: 'fx', base: b, quote: q, group: 'ny17',
        symbols: { yahoo: `${b}${q}=X`, twelvedata: `${b}/${q}`, stooq: `${b}${q}`.toLowerCase() },
      });
    }
  }
  return out;
}

// Skład DAX 40 (notowania Xetra).
const DAX_STOCKS = [
  ['ADS', 'adidas'], ['AIR', 'Airbus'], ['ALV', 'Allianz'], ['BAS', 'BASF'], ['BAYN', 'Bayer'], ['BEI', 'Beiersdorf'], ['BMW', 'BMW'], ['BNR', 'Brenntag'],
  ['CBK', 'Commerzbank'], ['CON', 'Continental'], ['DTG', 'Daimler Truck'], ['DBK', 'Deutsche Bank'], ['DB1', 'Deutsche Börse'], ['DHL', 'DHL Group'], ['DTE', 'Deutsche Telekom'],
  ['EOAN', 'E.ON'], ['FRE', 'Fresenius'], ['FME', 'Fresenius Medical Care'], ['G1A', 'GEA Group'], ['HNR1', 'Hannover Rück'], ['HEI', 'Heidelberg Materials'], ['HEN3', 'Henkel'],
  ['IFX', 'Infineon'], ['MBG', 'Mercedes-Benz'], ['MRK', 'Merck KGaA'], ['MTX', 'MTU Aero Engines'], ['MUV2', 'Munich Re'], ['PAH3', 'Porsche SE'], ['QIA', 'Qiagen'],
  ['RHM', 'Rheinmetall'], ['RWE', 'RWE'], ['SAP', 'SAP'], ['G24', 'Scout24'], ['SIE', 'Siemens'], ['ENR', 'Siemens Energy'], ['SHL', 'Siemens Healthineers'], ['SY1', 'Symrise'],
  ['VOW3', 'Volkswagen'], ['VNA', 'Vonovia'], ['ZAL', 'Zalando'],
];

// 50 największych spółek indeksu S&P 500 (kolejne można dodać w ustawieniach).
const SP_STOCKS = [
  ['NVDA', 'Nvidia'], ['MSFT', 'Microsoft'], ['AAPL', 'Apple'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'], ['META', 'Meta Platforms'], ['AVGO', 'Broadcom'], ['TSLA', 'Tesla'],
  ['BRK-B', 'Berkshire Hathaway'], ['JPM', 'JPMorgan Chase'], ['LLY', 'Eli Lilly'], ['V', 'Visa'], ['XOM', 'Exxon Mobil'], ['MA', 'Mastercard'], ['NFLX', 'Netflix'], ['COST', 'Costco'],
  ['WMT', 'Walmart'], ['ORCL', 'Oracle'], ['JNJ', 'Johnson & Johnson'], ['HD', 'Home Depot'], ['PG', 'Procter & Gamble'], ['ABBV', 'AbbVie'], ['BAC', 'Bank of America'], ['PLTR', 'Palantir'],
  ['KO', 'Coca-Cola'], ['UNH', 'UnitedHealth'], ['CRM', 'Salesforce'], ['CSCO', 'Cisco'], ['PM', 'Philip Morris'], ['GE', 'GE Aerospace'], ['WFC', 'Wells Fargo'], ['CVX', 'Chevron'],
  ['IBM', 'IBM'], ['AMD', 'AMD'], ['ABT', 'Abbott'], ['MCD', "McDonald's"], ['LIN', 'Linde'], ['DIS', 'Walt Disney'], ['NOW', 'ServiceNow'], ['MRK', 'Merck & Co.'],
  ['T', 'AT&T'], ['GS', 'Goldman Sachs'], ['INTU', 'Intuit'], ['UBER', 'Uber'], ['RTX', 'RTX'], ['CAT', 'Caterpillar'], ['PEP', 'PepsiCo'], ['AXP', 'American Express'],
  ['BKNG', 'Booking Holdings'], ['VZ', 'Verizon'],
];

export const DEFAULT_INSTRUMENTS = [
  ...fxPairs(),
  { id: 'XAUUSD', name: 'Gold', class: 'metal', category: 'metal', base: 'XAU', quote: 'USD', group: 'ny17', symbols: { yahoo: 'GC=F', twelvedata: 'XAU/USD', stooq: 'xauusd' } },
  { id: 'XAGUSD', name: 'Silver', class: 'metal', category: 'metal', base: 'XAG', quote: 'USD', group: 'ny17', symbols: { yahoo: 'SI=F', twelvedata: 'XAG/USD', stooq: 'xagusd' } },
  { id: 'XPTUSD', name: 'Platinum', class: 'metal', category: 'metal', base: 'XPT', quote: 'USD', group: 'ny17', symbols: { yahoo: 'PL=F', twelvedata: 'XPT/USD', stooq: 'xptusd' } },
  { id: 'XPDUSD', name: 'Palladium', class: 'metal', category: 'metal', base: 'XPD', quote: 'USD', group: 'ny17', symbols: { yahoo: 'PA=F', twelvedata: 'XPD/USD', stooq: 'xpdusd' } },
  { id: 'COPPER', name: 'Copper', class: 'metal', category: 'metal', base: 'XCU', quote: 'USD', group: 'ny17', symbols: { yahoo: 'HG=F', twelvedata: 'XCU/USD', stooq: 'hg.f' } },
  { id: 'SPX', name: 'S&P 500', class: 'index', category: 'index', group: 'us', symbols: { yahoo: '^GSPC', twelvedata: 'SPX', stooq: '^spx' } },
  { id: 'NDX', name: 'Nasdaq 100', class: 'index', category: 'index', group: 'us', symbols: { yahoo: '^NDX', twelvedata: 'NDX', stooq: '^ndx' } },
  { id: 'DJI', name: 'Dow Jones', class: 'index', category: 'index', group: 'us', symbols: { yahoo: '^DJI', twelvedata: 'DJI', stooq: '^dji' } },
  { id: 'RUT', name: 'Russell 2000', class: 'index', category: 'index', group: 'us', symbols: { yahoo: '^RUT', twelvedata: 'RUT', stooq: '' } },
  { id: 'DAX', name: 'DAX 40', class: 'index', category: 'index', group: 'europe', symbols: { yahoo: '^GDAXI', twelvedata: 'GDAXI', stooq: '^dax' } },
  { id: 'FTSE', name: 'FTSE 100', class: 'index', category: 'index', group: 'europe', symbols: { yahoo: '^FTSE', twelvedata: 'FTSE', stooq: '^ukx' } },
  { id: 'CAC', name: 'CAC 40', class: 'index', category: 'index', group: 'europe', symbols: { yahoo: '^FCHI', twelvedata: 'FCHI', stooq: '^cac' } },
  { id: 'STOXX50', name: 'Euro Stoxx 50', class: 'index', category: 'index', group: 'europe', symbols: { yahoo: '^STOXX50E', twelvedata: 'STOXX50E', stooq: '' } },
  { id: 'WIG20', name: 'WIG20', class: 'index', category: 'index', group: 'europe', symbols: { yahoo: 'WIG20.WA', twelvedata: 'WIG20', stooq: 'wig20' } },
  { id: 'N225', name: 'Nikkei 225', class: 'index', category: 'index', group: 'tokyo', symbols: { yahoo: '^N225', twelvedata: 'N225', stooq: '^nkx' } },
  { id: 'HSI', name: 'Hang Seng', class: 'index', category: 'index', group: 'hk', symbols: { yahoo: '^HSI', twelvedata: 'HSI', stooq: '^hsi' } },
  ...DAX_STOCKS.map(([t, name]) => ({ id: `${t}.DE`, name, class: 'stock', category: 'dax', group: 'europe', symbols: { yahoo: `${t}.DE`, twelvedata: `${t}:XETR`, stooq: `${t.toLowerCase()}.de` } })),
  ...SP_STOCKS.map(([t, name]) => ({ id: t.replace('-', '.'), name, class: 'stock', category: 'sp500', group: 'us', symbols: { yahoo: t, twelvedata: t.replace('-', '.'), stooq: `${t.toLowerCase()}.us` } })),
];

export const DEFAULT_SETTINGS = {
  data: {
    provider: 'yahoo',          // yahoo | twelvedata | stooq
    fallbackProvider: '',       // opcjonalne źródło zapasowe
    twelvedataKey: '',
    stooqKey: '',
    historyYears: 3,
  },
  ichimoku: { tenkan: 9, kijun: 26, senkou: 52, shift: 26, atr: 14 },
  scoring: {
    dirThreshold: 4,            // |wynik D1| od którego uznajemy kierunek
    strongCurrency: 2,          // próg siły waluty dla symetrii CLEAN
    extWarn: 2,                 // odległość od Kijun w ATR: ostrzeżenie
    extMax: 3,                  // odległość od Kijun w ATR: przegrzanie
  },
  sessions: { enabled: true },         // przepływ sesji z danych godzinowych par walutowych
  h4: { enabled: true, delay_min: 5 }, // analiza otwartych pozycji co 4 godziny
  risk: { maxTotal: 5, maxCurrency: 2.5, maxPosition: 1.5 },
  capital: { start: 0, currency: 'PLN', defaultRisk: 1 },
  notify: {
    mode: 'report',             // off | alerts | report
    minGrade: 'B',
    positions: 'changes',       // e-maile o otwartych pozycjach (H4): off | changes | always
    lang: '',                   // język e-maili: pl | de | en (puste = ustawi przeglądarka przy pierwszym uruchomieniu)              // alerty dla setupów od tej klasy
  },
  smtp: { host: '', port: 587, security: 'starttls', user: '', pass: '', from: '', to: '' },
};
