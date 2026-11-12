// Default configuration: time groups, instruments, settings.

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
  { key: 'crypto', name: 'Crypto – UTC midnight', close_time: '00:00', timezone: 'UTC', delay_min: 10, days: '1,2,3,4,5,6,7' },
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

// DAX 40 constituents (Xetra listings).
const DAX_STOCKS = [
  ['ADS', 'adidas'], ['AIR', 'Airbus'], ['ALV', 'Allianz'], ['BAS', 'BASF'], ['BAYN', 'Bayer'], ['BEI', 'Beiersdorf'], ['BMW', 'BMW'], ['BNR', 'Brenntag'],
  ['CBK', 'Commerzbank'], ['CON', 'Continental'], ['DTG', 'Daimler Truck'], ['DBK', 'Deutsche Bank'], ['DB1', 'Deutsche Börse'], ['DHL', 'DHL Group'], ['DTE', 'Deutsche Telekom'],
  ['EOAN', 'E.ON'], ['FRE', 'Fresenius'], ['FME', 'Fresenius Medical Care'], ['G1A', 'GEA Group'], ['HNR1', 'Hannover Rück'], ['HEI', 'Heidelberg Materials'], ['HEN3', 'Henkel'],
  ['IFX', 'Infineon'], ['MBG', 'Mercedes-Benz'], ['MRK', 'Merck KGaA'], ['MTX', 'MTU Aero Engines'], ['MUV2', 'Munich Re'], ['PAH3', 'Porsche SE'], ['QIA', 'Qiagen'],
  ['RHM', 'Rheinmetall'], ['RWE', 'RWE'], ['SAP', 'SAP'], ['G24', 'Scout24'], ['SIE', 'Siemens'], ['ENR', 'Siemens Energy'], ['SHL', 'Siemens Healthineers'], ['SY1', 'Symrise'],
  ['VOW3', 'Volkswagen'], ['VNA', 'Vonovia'], ['ZAL', 'Zalando'],
];

// The 50 largest S&P 500 companies (more can be added in settings).
const SP_STOCKS = [
  ['NVDA', 'Nvidia'], ['MSFT', 'Microsoft'], ['AAPL', 'Apple'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'], ['META', 'Meta Platforms'], ['AVGO', 'Broadcom'], ['TSLA', 'Tesla'],
  ['BRK-B', 'Berkshire Hathaway'], ['JPM', 'JPMorgan Chase'], ['LLY', 'Eli Lilly'], ['V', 'Visa'], ['XOM', 'Exxon Mobil'], ['MA', 'Mastercard'], ['NFLX', 'Netflix'], ['COST', 'Costco'],
  ['WMT', 'Walmart'], ['ORCL', 'Oracle'], ['JNJ', 'Johnson & Johnson'], ['HD', 'Home Depot'], ['PG', 'Procter & Gamble'], ['ABBV', 'AbbVie'], ['BAC', 'Bank of America'], ['PLTR', 'Palantir'],
  ['KO', 'Coca-Cola'], ['UNH', 'UnitedHealth'], ['CRM', 'Salesforce'], ['CSCO', 'Cisco'], ['PM', 'Philip Morris'], ['GE', 'GE Aerospace'], ['WFC', 'Wells Fargo'], ['CVX', 'Chevron'],
  ['IBM', 'IBM'], ['AMD', 'AMD'], ['ABT', 'Abbott'], ['MCD', "McDonald's"], ['LIN', 'Linde'], ['DIS', 'Walt Disney'], ['NOW', 'ServiceNow'], ['MRK', 'Merck & Co.'],
  ['T', 'AT&T'], ['GS', 'Goldman Sachs'], ['INTU', 'Intuit'], ['UBER', 'Uber'], ['RTX', 'RTX'], ['CAT', 'Caterpillar'], ['PEP', 'PepsiCo'], ['AXP', 'American Express'],
  ['BKNG', 'Booking Holdings'], ['VZ', 'Verizon'],
];

// The "Scalable" block: the most popular instruments available at the broker Scalable Capital
// (Xetra ETFs, European and US stocks, cryptocurrencies). Symbols verified against Yahoo Finance.
// Disabled by default – enabled with one click in Settings → Instruments.
const SC_ETF = [
  ["EUNL.DE", "iShares Core MSCI World"],
  ["VWCE.DE", "Vanguard FTSE All-World Acc"],
  ["VGWL.DE", "Vanguard FTSE All-World Dist"],
  ["SXR8.DE", "iShares Core S&P 500"],
  ["VUSA.DE", "Vanguard S&P 500"],
  ["IS3N.DE", "iShares Core MSCI EM IMI"],
  ["XDWD.DE", "Xtrackers MSCI World"],
  ["SXRV.DE", "iShares Nasdaq 100"],
  ["EXS1.DE", "iShares Core DAX"],
  ["EXSA.DE", "iShares STOXX Europe 600"],
  ["IUSQ.DE", "iShares MSCI ACWI"],
  ["EUNK.DE", "iShares Core MSCI Europe"],
  ["XDWT.DE", "Xtrackers MSCI World IT"],
  ["QDVE.DE", "iShares S&P 500 IT Sector"],
  ["IQQH.DE", "iShares Global Clean Energy"],
  ["EXXT.DE", "iShares Nasdaq-100 (DE)"],
  ["SXRT.DE", "iShares Core EURO STOXX 50"],
  ["4GLD.DE", "Xetra-Gold"],
  ["IS3Q.DE", "iShares MSCI World Quality"],
  ["IUSN.DE", "iShares MSCI World Small Cap"],
  ["XMME.DE", "Xtrackers MSCI Emerging Markets"],
  ["EUNA.DE", "iShares Core Global Aggregate Bond"],
  ["VGWD.DE", "Vanguard FTSE All-World High Dividend"],
  ["ISPA.DE", "iShares STOXX Global Select Dividend 100"],
  ["VDIV.DE", "VanEck Developed Markets Dividend Leaders"],
  ["XAIX.DE", "Xtrackers AI & Big Data"],
  ["2B76.DE", "iShares Automation & Robotics"],
  ["EXV1.DE", "iShares STOXX Europe 600 Banks"],
  ["DBXD.DE", "Xtrackers DAX"],
  ["XD9U.DE", "Xtrackers MSCI USA"],
  ["EXW1.DE", "iShares EURO STOXX 50 (DE)"],
  ["SXRW.DE", "iShares Core FTSE 100"],
  ["IQQW.DE", "iShares MSCI World Dist"],
  ["XDEM.DE", "Xtrackers MSCI World Momentum"],
  ["EXH1.DE", "iShares STOXX Europe 600 Oil & Gas"],
  ["IBCD.DE", "iShares USD Corporate Bond"],
  ["SXRS.DE", "iShares Diversified Commodity Swap"],
  ["XDJP.DE", "Xtrackers Nikkei 225"],
  ["ICGA.DE", "iShares MSCI China"],
];
const SC_EU = [
  ["ASML.AS", "ASML"],
  ["MC.PA", "LVMH"],
  ["OR.PA", "L'Oréal"],
  ["TTE.PA", "TotalEnergies"],
  ["SAN.PA", "Sanofi"],
  ["SU.PA", "Schneider Electric"],
  ["AI.PA", "Air Liquide"],
  ["RMS.PA", "Hermès"],
  ["BNP.PA", "BNP Paribas"],
  ["NESN.SW", "Nestlé"],
  ["NOVN.SW", "Novartis"],
  ["UBSG.SW", "UBS"],
  ["SHEL.L", "Shell"],
  ["AZN.L", "AstraZeneca"],
  ["HSBA.L", "HSBC"],
  ["ULVR.L", "Unilever"],
  ["BP.L", "BP"],
  ["NOVO-B.CO", "Novo Nordisk"],
  ["SAN.MC", "Banco Santander"],
  ["ITX.MC", "Inditex"],
  ["IBE.MC", "Iberdrola"],
  ["ENEL.MI", "Enel"],
  ["RACE.MI", "Ferrari"],
  ["ISP.MI", "Intesa Sanpaolo"],
  ["UCG.MI", "UniCredit"],
  ["INGA.AS", "ING"],
  ["ADYEN.AS", "Adyen"],
  ["PRX.AS", "Prosus"],
  ["NOKIA.HE", "Nokia"],
  ["PKN.WA", "Orlen"],
  ["PKO.WA", "PKO BP"],
  ["CDR.WA", "CD Projekt"],
  ["PZU.WA", "PZU"],
  ["KGH.WA", "KGHM"],
];
const SC_US = [
  ["COIN", "Coinbase"],
  ["MSTR", "Strategy"],
  ["SHOP", "Shopify"],
  ["PYPL", "PayPal"],
  ["INTC", "Intel"],
  ["MU", "Micron"],
  ["QCOM", "Qualcomm"],
  ["ADBE", "Adobe"],
  ["NKE", "Nike"],
  ["SBUX", "Starbucks"],
  ["BA", "Boeing"],
  ["F", "Ford"],
  ["GM", "General Motors"],
  ["PFE", "Pfizer"],
  ["MRNA", "Moderna"],
  ["SNOW", "Snowflake"],
  ["CRWD", "CrowdStrike"],
  ["PANW", "Palo Alto Networks"],
  ["ARM", "Arm Holdings"],
  ["SMCI", "Super Micro Computer"],
  ["RIVN", "Rivian"],
  ["NIO", "NIO"],
  ["BABA", "Alibaba"],
  ["TSM", "TSMC"],
  ["ASML", "ASML (Nasdaq)"],
  ["NVO", "Novo Nordisk (NYSE)"],
  ["SPOT", "Spotify"],
  ["ABNB", "Airbnb"],
  ["HOOD", "Robinhood"],
  ["SOFI", "SoFi"],
  ["RBLX", "Roblox"],
  ["DKNG", "DraftKings"],
  ["LCID", "Lucid"],
  ["TXN", "Texas Instruments"],
  ["AMAT", "Applied Materials"],
  ["LRCX", "Lam Research"],
  ["MRVL", "Marvell"],
  ["DELL", "Dell"],
  ["ORLY", "O'Reilly"],
];
const SC_CRYPTO = [
  ["BTC-EUR", "Bitcoin"],
  ["ETH-EUR", "Ethereum"],
  ["SOL-EUR", "Solana"],
  ["XRP-EUR", "XRP"],
  ["ADA-EUR", "Cardano"],
  ["DOGE-EUR", "Dogecoin"],
  ["LINK-EUR", "Chainlink"],
  ["DOT-EUR", "Polkadot"],
  ["AVAX-EUR", "Avalanche"],
  ["LTC-EUR", "Litecoin"],
];
const scId = (sym) => sym.toUpperCase();

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
  ...SC_ETF.map(([t, name]) => ({ id: scId(t), name, class: 'etf', category: 'scalable', group: 'europe', enabled: false, symbols: { yahoo: t } })),
  ...SC_EU.map(([t, name]) => ({ id: scId(t), name, class: 'stock', category: 'scalable', group: 'europe', enabled: false, symbols: { yahoo: t } })),
  ...SC_US.map(([t, name]) => ({ id: scId(t), name, class: 'stock', category: 'scalable', group: 'us', enabled: false, symbols: { yahoo: t, twelvedata: t } })),
  ...SC_CRYPTO.map(([t, name]) => ({ id: scId(t.replace('-', '')), name, class: 'crypto', category: 'scalable', group: 'crypto', enabled: false, symbols: { yahoo: t, twelvedata: t.replace('-', '/') } })),
  ...SP_STOCKS.map(([t, name]) => ({ id: t.replace('-', '.'), name, class: 'stock', category: 'sp500', group: 'us', symbols: { yahoo: t, twelvedata: t.replace('-', '.'), stooq: `${t.toLowerCase()}.us` } })),
];

export const DEFAULT_SETTINGS = {
  data: {
    provider: 'yahoo',          // yahoo | twelvedata | stooq
    fallbackProvider: '',       // optional fallback source
    twelvedataKey: '',
    stooqKey: '',
    finnhubKey: '',
    eodhdKey: '',
    liveProvider: '',           // live price source for open positions (empty = same as data)
    liveSeconds: 20,            // how often to refresh open-position prices, in seconds
    historyYears: 3,
  },
  ichimoku: { tenkan: 9, kijun: 26, senkou: 52, shift: 26, atr: 14 },
  scoring: {
    dirThreshold: 4,            // |D1 score| from which a direction is declared
    strongCurrency: 2,          // currency strength threshold for CLEAN symmetry
    extWarn: 2,                 // distance from Kijun in ATR: warning
    extMax: 3,                  // distance from Kijun in ATR: overextended
  },
  sessions: { enabled: true },         // session flow from hourly currency-pair data
  h4: { enabled: true, delay_min: 5 }, // open-position analysis every 4 hours
  risk: { maxTotal: 5, maxCurrency: 2.5, maxPosition: 1.5 },
  capital: { start: 0, currency: 'EUR', defaultRisk: 1 },
  appearance: { theme: 'normal', accent: '', loginBg: 'aurora', appBg: 'default', custom: {} },
  notify: {
    mode: 'report',             // off | alerts | report
    minGrade: 'B',
    positions: 'changes',       // e-mails about open positions (H4): off | changes | always
    lang: '',                   // e-mail language: pl | de | en (empty = set by the browser on first run)
  },
  smtp: { host: '', port: 587, security: 'starttls', user: '', pass: '', from: '', to: '',
    auth: 'password',           // password | oauth2 (Google)
    oauthClientId: '', oauthClientSecret: '', oauthRefreshToken: '' },
};
