// Instrukcja obsługi w trzech językach. Sekcja: { id, title, body }, gdzie body to lista
// akapitów (string) i wypunktowań (tablica stringów). **pogrubienie** jest obsługiwane.

const pl = [
  { id: 'what', title: 'Czym jest KumoDesk', body: [
    'KumoDesk pomaga zdecydować, **co grać i jak**, na podstawie Ichimoku na świecach dziennych. Sam niczego nie kupuje ani nie sprzedaje – nie łączy się z brokerem. Zlecenia składasz samodzielnie, a w aplikacji tylko je odnotowujesz.',
    'Narzędzie nie jest poradą inwestycyjną. Pokazuje stan rynku według jawnych reguł; decyzja i ryzyko są Twoje.',
  ] },
  { id: 'start', title: 'Pierwsze kroki', body: [
    [
      'Kliknij **Odśwież dane** w prawym górnym rogu. Pierwsze pobranie trwa około 2 minut.',
      'W **Ustawienia → Kapitał** wpisz kapitał początkowy, walutę rachunku i domyślne ryzyko na pozycję.',
      'W **Ustawienia → Ryzyko** ustaw limity: łączne ryzyko, ekspozycja na walutę, ryzyko pojedynczej pozycji.',
      'W **Ustawienia → Powiadomienia** wpisz serwer SMTP i wyślij wiadomość testową, jeśli chcesz dostawać raporty e-mailem.',
      'W **Ustawienia → Instrumenty** wyłącz kategorie, których nie grasz (np. spółki S&P 500) – jednym kliknięciem.',
    ],
    'Od tej chwili aplikacja sama pobiera dane po zamknięciu każdej grupy rynków i przelicza analizę.',
  ] },
  { id: 'modes', title: 'Dwa widoki: Pro i Basic', body: [
    'W prawym górnym rogu, obok języka, jest przełącznik **Basic / Pro**. Wybór jest zapamiętywany w przeglądarce.',
    [
      '**Pro** (domyślny) – pełny widok: kafelki rynku, lejek, siła walut, sesje, ranking i tabela wszystkich instrumentów.',
      '**Basic** – widok uproszczony. Jedno zdanie o tym, czy dziś w ogóle grać, oraz **najwyżej trzy instrumenty**: główny wybór i dwie alternatywy. Przy każdym: kupić czy sprzedać, krótkie uzasadnienie, ostatnia cena i stop.',
    ],
    'Basic pokazuje tylko instrumenty z decyzją „graj”, pomija te skorelowane z lepszym wyborem i te, na których masz już pozycję. Jeśli nic nie spełnia warunków, zobaczysz komunikat, że dziś nie ma nic do grania – to też jest informacja.',
    'Oba widoki korzystają z tej samej analizy. Basic niczego nie liczy inaczej, tylko pokazuje mniej.',
  ] },
  { id: 'routine', title: 'Codzienna praca', body: [
    [
      '**Po zamknięciu rynku** otwórz Dashboard (albo przeczytaj raport e-mail). Analiza używa wyłącznie zamkniętych świec dziennych.',
      'Sprawdź **tryb operacyjny** i Matrix Score: czy rynek w ogóle daje przewagę.',
      'Przejrzyj **Główny cel** i **Najlepsze setupy**. Kliknij instrument, aby zobaczyć wykres, plan i drogę przez lejek.',
      'Jeśli otwierasz pozycję u brokera, kliknij **Dodaj do otwartych pozycji** na stronie instrumentu.',
      '**W ciągu dnia** aplikacja co 4 godziny sprawdza otwarte pozycje na świecach H4 i mówi, co z nimi zrobić.',
      'Po zamknięciu pozycji u brokera kliknij **Zamknij pozycję** w Portfelu – wynik trafi do historii i statystyk kapitału.',
    ],
  ] },
  { id: 'dashboard', title: 'Jak czytać Dashboard', body: [
    '**Kafelki u góry** opisują cały rynek:',
    [
      '**Reżim rynku** – trendowy, rotacyjny albo konsolidacja. W konsolidacji wybicia często zawodzą.',
      '**Klimat** – risk-on (silne waluty carry: AUD, NZD, CAD) albo risk-off (silne bezpieczne: JPY, CHF, USD).',
      '**Tryb egzekucji** – ofensywny, selektywny lub defensywny. Wynika z Matrix Score.',
      '**Zgodność W1/D1** – jaka część sygnałów dziennych zgadza się z tygodniem.',
      '**Symetria** – jaka część sygnałów walutowych ma poparcie w całym koszyku walut.',
      '**Ryzyko portfela** – OK, UWAGA lub BLOKADA według Twoich limitów.',
      '**Matrix Score** – ocena 0–100: od 70 tryb ofensywny, od 45 selektywny, poniżej defensywny.',
    ],
    '**Lejek decyzyjny** pokazuje, ile instrumentów zostaje po każdym z dziewięciu etapów. Kliknij etap, aby tabela na dole pokazała, co na nim odpadło.',
    '**Siła walut** to średni wynik Ichimoku każdej waluty ze wszystkich jej par (od −10 do +10). Najlepsze pary to silna waluta przeciw słabej.',
    '**Przepływ sesji** pokazuje, która waluta była najsilniejsza i najsłabsza w ostatniej sesji Sydney, Tokio, Londynu i Nowego Jorku. To kontekst, nie sygnał.',
    '**Zagrożenia** zbierają ostrzeżenia: naruszony stop, odwrócony sygnał, przekroczone limity.',
  ] },
  { id: 'closed', title: 'Analiza tylko na zamkniętych świecach', body: [
    'Wszystkie oceny, klasy i decyzje liczone są **wyłącznie na zamkniętych świecach dziennych**. Świeca, która jeszcze trwa, nie jest brana pod uwagę – w ciągu dnia jej kształt się zmienia i sygnał mógłby pojawiać się i znikać.',
    'W praktyce oznacza to, że **dzisiejsza analiza opiera się na świecy z wczoraj** (ostatniej zamkniętej). Nowa analiza powstaje dopiero po końcu handlu danej grupy rynków, o godzinie ustawionej w grupach czasowych.',
    'Na stronie instrumentu nad wykresem są dwa przyciski:',
    [
      '**Wykres użyty do analizy** – dokładnie te świece, na których policzono ocenę. To on uzasadnia decyzję.',
      '**Wykres obecny** – to samo plus świeca, która jeszcze trwa (rysowana samym obrysem), ze świeżo pobranymi danymi. Służy do podglądu, co dzieje się teraz; nie zmienia ocen.',
    ],
    'Ta sama zasada dotyczy prowadzenia pozycji: zalecenia co 4 godziny liczone są na zamkniętych świecach H4.',
  ] },
  { id: 'grades', title: 'Wynik, klasy i decyzje', body: [
    'Każdy instrument dostaje **wynik Ichimoku od −10 do +10** na D1 i na W1. Składają się na niego: cena względem chmury (±3), Tenkan względem Kijun (±2), Chikou (±2), cena względem Kijun (±1), kolor chmury przyszłej (±1), nachylenie Kijun (±1).',
    '**Okazja 0–10** łączy wynik D1, zgodność z W1 i symetrię, minus kara za przegrzanie (cena daleko od Kijun).',
    [
      '**Klasa A** – setup główny: okazja co najmniej 8, W1 zgodny, cena i Chikou poza chmurą, czysta symetria, brak przegrzania, zgodnie z klimatem.',
      '**Klasa B** – setup warunkowy: okazja co najmniej 6,5, bez konfliktu interwałów.',
      '**Klasa C** – obserwacja: kierunek jest, jakość za słaba.',
      '**Klasa D** – brak transakcji.',
    ],
    'Decyzja: **GRAJ** (A zawsze, B gdy tryb nie jest defensywny), **OBSERWUJ** (C albo zablokowany portfel), **CZEKAJ** (D).',
    'Znak **≈** przy setupie oznacza korelację: gra tę samą walutę w tę samą stronę co lepszy setup. Nie dubluj ryzyka.',
  ] },
  { id: 'instrument', title: 'Strona instrumentu', body: [
    [
      '**Wykres Ichimoku** z przełącznikiem D1 / H4 (H4 pojawia się dla instrumentów z otwartą pozycją). Najedź kursorem, aby zobaczyć wartości.',
      '**Droga przez lejek** – dziewięć etapów ze statusem i powodem. Tu widać, dlaczego instrument odpadł albo przeszedł.',
      '**Plan** – warunek wejścia, poziom unieważnienia i proponowany stop, plus poziomy Tenkan, Kijun, chmury i ATR.',
      '**Wynik D1 w czasie** – jak długo trwa obecny kierunek.',
      '**Składowe wyniku** D1 i W1 – z czego dokładnie wynika ocena.',
    ],
  ] },
  { id: 'positions', title: 'Pozycje i prowadzenie na H4', body: [
    'Przycisk **Dodaj do otwartych pozycji** otwiera okno jak u brokera: kierunek, ryzyko w % kapitału i stop. Cena wejścia jest pobierana z API w chwili zapisu. **To tylko wpis na listę** – zlecenie u brokera składasz sam.',
    'Co 4 godziny (00, 04, 08, 12, 16, 20 UTC) aplikacja ocenia każdą pozycję na zamkniętych świecach H4:',
    [
      '**TRZYMAJ** – H4 i D1 wspierają pozycję.',
      '**PODCIĄGNIJ STOP** – pozycja jest co najmniej 1R na plusie; proponowany stop za Kijun H4.',
      '**ZREALIZUJ CZĘŚĆ** – trend trwa, ale cena jest mocno rozciągnięta.',
      '**ZACIEŚNIJ STOP** – H4 zamknął się po złej stronie Kijun albo sygnał dzienny wygasł.',
      '**ZMNIEJSZ POZYCJĘ** – H4 w pełni przeciw pozycji, choć D1 jeszcze ją wspiera.',
      '**ZAMKNIJ** – naruszony stop, odwrócony sygnał dzienny albo H4 przeciw bez wsparcia D1.',
    ],
    'Proponowany stop przesuwa się tylko w stronę zysku. Przycisk **Ustaw proponowany stop** zapisuje go w aplikacji – u brokera zmieniasz go sam.',
  ] },
  { id: 'capital', title: 'Zamykanie pozycji i kapitał', body: [
    'W Portfelu kliknij **Zamknij pozycję**. Cena wyjścia jest podpowiadana z API – popraw ją na faktyczną. Możesz też wpisać dokładny wynik kwotowy z rachunku.',
    'Wynik w **R** to zysk lub strata w jednostkach początkowego ryzyka: +2R oznacza zysk dwa razy większy niż ryzykowana kwota.',
    '**Ustawienia → Kapitał** pokazuje kapitał początkowy i obecny, zysk, średni wynik na zagranie, skuteczność, profit factor, maksymalne obsunięcie, krzywą kapitału i tabelę wszystkich zagrań.',
    'Wynik pieniężny liczony jest jako kapitał przed zagraniem × ryzyko % × wynik w R. Nie zawiera spreadów, prowizji ani swapów.',
  ] },
  { id: 'settings', title: 'Ustawienia w skrócie', body: [
    [
      '**Grupy czasowe** – każdy rynek kończy dzień o innej godzinie. Grupa ma godzinę końca handlu i strefę czasową; po niej aplikacja pobiera dane i analizuje instrumenty z tej grupy.',
      '**Instrumenty** – pogrupowane w kategorie, które włączasz i wyłączasz jednym kliknięciem. Własny instrument dodajesz, podając symbol źródła danych i grupę czasową.',
      '**Dane rynkowe** – wybór źródła (domyślnie Yahoo Finance, alternatywnie Twelve Data lub Stooq) i źródła zapasowego.',
      '**Ichimoku i ocena** – okresy 9 / 26 / 52 oraz progi oceny; tu też wyłączysz analizę H4 i sesji.',
      '**Powiadomienia** – SMTP, raport po analizie grupy, alerty o nowych setupach i o zmianie zalecenia dla pozycji.',
    ],
  ] },
  { id: 'limits', title: 'Ograniczenia, o których warto pamiętać', body: [
    [
      'Yahoo Finance to źródło nieoficjalne: może przestać działać lub zwrócić błędne dane. Przy podejrzanych świecach porównaj z wykresem brokera.',
      'Świeca dzienna walut z Yahoo kończy się o północy czasu londyńskiego, nie o 17:00 w Nowym Jorku.',
      'Metale to kontrakty terminowe (np. złoto GC=F), nie ceny spot.',
      'Ceny w aplikacji mogą różnić się od cen u Twojego brokera.',
      'Aplikacja nie ma logowania – trzymaj ją w sieci lokalnej albo za proxy z hasłem.',
    ],
  ] },
];

const en = [
  { id: 'what', title: 'What KumoDesk is', body: [
    'KumoDesk helps you decide **what to trade and how**, using Ichimoku on daily candles. It never buys or sells anything – it is not connected to a broker. You place orders yourself and only log them in the app.',
    'The tool is not investment advice. It shows the state of the market according to explicit rules; the decision and the risk are yours.',
  ] },
  { id: 'start', title: 'Getting started', body: [
    [
      'Click **Refresh data** in the top right corner. The first download takes about 2 minutes.',
      'In **Settings → Capital** enter your starting capital, account currency and default risk per position.',
      'In **Settings → Risk** set the limits: total risk, per-currency exposure, per-position risk.',
      'In **Settings → Notifications** enter your SMTP server and send a test message if you want reports by e-mail.',
      'In **Settings → Instruments** switch off the categories you do not trade (e.g. S&P 500 stocks) – with one click.',
    ],
    'From then on the app downloads data after each market group closes and recalculates the analysis on its own.',
  ] },
  { id: 'modes', title: 'Two views: Pro and Basic', body: [
    'In the top right corner, next to the language, there is a **Basic / Pro** switch. The choice is remembered in your browser.',
    [
      '**Pro** (default) – the full view: market tiles, funnel, currency strength, sessions, ranking and the table of all instruments.',
      '**Basic** – the simplified view. One sentence on whether to trade at all today, and **at most three instruments**: the main pick and two alternatives. For each: buy or sell, a short reason, the last price and the stop.',
    ],
    'Basic shows only instruments with a “trade” decision, skips those correlated with a better pick and those you already hold. If nothing qualifies you will see that there is nothing to trade today – that is information too.',
    'Both views use the same analysis. Basic calculates nothing differently, it just shows less.',
  ] },
  { id: 'routine', title: 'Daily routine', body: [
    [
      '**After the market closes** open the Dashboard (or read the e-mail report). The analysis uses closed daily candles only.',
      'Check the **operating mode** and Matrix Score: does the market offer an edge at all.',
      'Go through the **Primary target** and **Best setups**. Click an instrument to see its chart, plan and path through the funnel.',
      'If you open a position at your broker, click **Add to open positions** on the instrument page.',
      '**During the day** the app checks open positions on H4 candles every 4 hours and tells you what to do with them.',
      'After closing a position at your broker, click **Close position** in Portfolio – the result goes into the history and capital statistics.',
    ],
  ] },
  { id: 'dashboard', title: 'Reading the Dashboard', body: [
    '**The tiles at the top** describe the whole market:',
    [
      '**Market regime** – trending, rotational or ranging. In a range, breakouts often fail.',
      '**Climate** – risk-on (strong carry currencies: AUD, NZD, CAD) or risk-off (strong safe havens: JPY, CHF, USD).',
      '**Execution mode** – offensive, selective or defensive. It follows from the Matrix Score.',
      '**W1/D1 alignment** – the share of daily signals that agree with the weekly chart.',
      '**Symmetry** – the share of currency signals backed by the whole currency basket.',
      '**Portfolio risk** – OK, CAUTION or BLOCK according to your limits.',
      '**Matrix Score** – a 0–100 rating: offensive from 70, selective from 45, defensive below.',
    ],
    'The **decision funnel** shows how many instruments are left after each of nine stages. Click a stage and the table at the bottom shows what dropped out there.',
    '**Currency strength** is the mean Ichimoku score of each currency across all its pairs (−10 to +10). The best pairs set a strong currency against a weak one.',
    '**Session flow** shows which currency was strongest and weakest in the latest Sydney, Tokyo, London and New York session. It is context, not a signal.',
    '**Threats** collect warnings: a breached stop, a reversed signal, exceeded limits.',
  ] },
  { id: 'closed', title: 'Analysis on closed candles only', body: [
    'All ratings, grades and decisions are calculated **on closed daily candles only**. A candle that is still in progress is ignored – its shape changes during the day and a signal could appear and disappear.',
    'In practice this means **today\'s analysis rests on yesterday\'s candle** (the last closed one). A new analysis is produced only after the end of trading for a market group, at the time set in the time groups.',
    'On the instrument page there are two buttons above the chart:',
    [
      '**Chart used for the analysis** – exactly the candles the rating was calculated on. This is the chart that justifies the decision.',
      '**Current chart** – the same plus the candle still in progress (drawn as an outline), with freshly downloaded data. It is for seeing what is happening now; it does not change the ratings.',
    ],
    'The same rule applies to position management: the advice every 4 hours is calculated on closed H4 candles.',
  ] },
  { id: 'grades', title: 'Score, grades and decisions', body: [
    'Every instrument gets an **Ichimoku score from −10 to +10** on D1 and on W1. It is made of: price vs the cloud (±3), Tenkan vs Kijun (±2), Chikou (±2), price vs Kijun (±1), future cloud colour (±1), Kijun slope (±1).',
    '**Opportunity 0–10** combines the D1 score, agreement with W1 and symmetry, minus a penalty for overextension (price far from Kijun).',
    [
      '**Grade A** – primary setup: opportunity at least 8, W1 agrees, price and Chikou clear of the cloud, clean symmetry, not overextended, in line with the climate.',
      '**Grade B** – conditional setup: opportunity at least 6.5, no timeframe conflict.',
      '**Grade C** – watch: there is a direction but quality is too weak.',
      '**Grade D** – no trade.',
    ],
    'Decision: **TRADE** (A always, B unless the mode is defensive), **WATCH** (C, or a blocked portfolio), **WAIT** (D).',
    'The **≈** mark next to a setup means correlation: it trades the same currency in the same direction as a better setup. Do not double the risk.',
  ] },
  { id: 'instrument', title: 'The instrument page', body: [
    [
      '**Ichimoku chart** with a D1 / H4 switch (H4 appears for instruments with an open position). Hover to read the values.',
      '**Path through the funnel** – nine stages with status and reason. This is where you see why an instrument dropped out or passed.',
      '**Plan** – entry trigger, invalidation level and suggested stop, plus Tenkan, Kijun, cloud and ATR levels.',
      '**D1 score over time** – how long the current direction has lasted.',
      '**Score components** for D1 and W1 – exactly what the rating is made of.',
    ],
  ] },
  { id: 'positions', title: 'Positions and H4 management', body: [
    'The **Add to open positions** button opens a broker-style ticket: direction, risk in % of capital and a stop. The entry price is fetched from the API when you save. **This is only a list entry** – you place the order at your broker yourself.',
    'Every 4 hours (00, 04, 08, 12, 16, 20 UTC) the app rates each position on closed H4 candles:',
    [
      '**HOLD** – H4 and D1 support the position.',
      '**TRAIL STOP** – the position is at least 1R in profit; suggested stop behind the H4 Kijun.',
      '**TAKE PARTIAL PROFIT** – the trend continues but price is heavily stretched.',
      '**TIGHTEN STOP** – H4 closed on the wrong side of Kijun, or the daily signal faded.',
      '**REDUCE POSITION** – H4 fully against the position while D1 still supports it.',
      '**CLOSE** – stop breached, daily signal reversed, or H4 against without D1 support.',
    ],
    'A suggested stop only ever moves in your favour. The **Apply suggested stop** button saves it in the app – you change it at your broker yourself.',
  ] },
  { id: 'capital', title: 'Closing positions and capital', body: [
    'In Portfolio click **Close position**. The exit price is suggested from the API – correct it to your real fill. You can also enter the exact money result from your account.',
    'A result in **R** is profit or loss in units of the initial risk: +2R means a profit twice the amount risked.',
    '**Settings → Capital** shows starting and current capital, profit, average result per trade, win rate, profit factor, maximum drawdown, the equity curve and a table of every trade.',
    'The money result is calculated as capital before the trade × risk % × result in R. It does not include spreads, commissions or swaps.',
  ] },
  { id: 'settings', title: 'Settings in brief', body: [
    [
      '**Time groups** – every market ends its day at a different time. A group has an end-of-trading time and a time zone; after it the app downloads data and analyses the instruments in that group.',
      '**Instruments** – organised in categories you switch on and off with one click. Add your own instrument by giving its data-source symbol and a time group.',
      '**Market data** – choice of source (Yahoo Finance by default, alternatively Twelve Data or Stooq) and a fallback source.',
      '**Ichimoku & scoring** – the 9 / 26 / 52 periods and scoring thresholds; H4 and session analysis are switched off here too.',
      '**Notifications** – SMTP, a report after each group analysis, alerts on new setups and on changed advice for positions.',
    ],
  ] },
  { id: 'limits', title: 'Limitations worth remembering', body: [
    [
      'Yahoo Finance is an unofficial source: it may stop working or return wrong data. If candles look suspicious, compare them with your broker\'s chart.',
      'Yahoo\'s daily currency candle ends at midnight London time, not at 17:00 New York.',
      'Metals are futures contracts (e.g. gold GC=F), not spot prices.',
      'Prices in the app may differ from prices at your broker.',
      'The app has no login – keep it on your local network or behind a password-protected proxy.',
    ],
  ] },
];

const de = [
  { id: 'what', title: 'Was KumoDesk ist', body: [
    'KumoDesk hilft bei der Entscheidung, **was und wie gehandelt wird**, auf Basis von Ichimoku auf Tageskerzen. Es kauft und verkauft nichts – es ist mit keinem Broker verbunden. Orders geben Sie selbst auf und tragen sie in der App nur ein.',
    'Das Werkzeug ist keine Anlageberatung. Es zeigt den Marktzustand nach offenen Regeln; Entscheidung und Risiko liegen bei Ihnen.',
  ] },
  { id: 'start', title: 'Erste Schritte', body: [
    [
      'Klicken Sie oben rechts auf **Daten aktualisieren**. Der erste Abruf dauert etwa 2 Minuten.',
      'Tragen Sie unter **Einstellungen → Kapital** Startkapital, Kontowährung und Standardrisiko je Position ein.',
      'Legen Sie unter **Einstellungen → Risiko** die Limits fest: Gesamtrisiko, Exposure je Währung, Risiko je Position.',
      'Tragen Sie unter **Einstellungen → Benachrichtigungen** Ihren SMTP-Server ein und senden Sie eine Testnachricht, wenn Sie Berichte per E-Mail möchten.',
      'Schalten Sie unter **Einstellungen → Instrumente** die Kategorien aus, die Sie nicht handeln (z. B. S&P-500-Aktien) – mit einem Klick.',
    ],
    'Von da an lädt die App nach dem Schluss jeder Marktgruppe selbst die Daten und berechnet die Analyse neu.',
  ] },
  { id: 'modes', title: 'Zwei Ansichten: Pro und Basic', body: [
    'Oben rechts, neben der Sprache, befindet sich der Umschalter **Basic / Pro**. Die Wahl wird im Browser gespeichert.',
    [
      '**Pro** (Standard) – die volle Ansicht: Marktkacheln, Trichter, Währungsstärke, Sessions, Rangliste und die Tabelle aller Instrumente.',
      '**Basic** – die vereinfachte Ansicht. Ein Satz dazu, ob heute überhaupt gehandelt werden sollte, und **höchstens drei Instrumente**: die Hauptauswahl und zwei Alternativen. Zu jedem: kaufen oder verkaufen, eine kurze Begründung, der letzte Kurs und der Stopp.',
    ],
    'Basic zeigt nur Instrumente mit der Entscheidung „Handeln“, lässt jene aus, die mit einer besseren Auswahl korrelieren oder die Sie bereits halten. Erfüllt nichts die Bedingungen, sehen Sie den Hinweis, dass es heute nichts zu handeln gibt – auch das ist eine Information.',
    'Beide Ansichten nutzen dieselbe Analyse. Basic berechnet nichts anders, es zeigt nur weniger.',
  ] },
  { id: 'routine', title: 'Tägliche Arbeit', body: [
    [
      '**Nach Marktschluss** das Dashboard öffnen (oder den E-Mail-Bericht lesen). Die Analyse nutzt ausschließlich geschlossene Tageskerzen.',
      '**Betriebsmodus** und Matrix Score prüfen: Bietet der Markt überhaupt einen Vorteil?',
      '**Hauptziel** und **Beste Setups** durchgehen. Ein Klick auf ein Instrument zeigt Chart, Plan und den Weg durch den Trichter.',
      'Wenn Sie beim Broker eine Position eröffnen, klicken Sie auf der Instrumentenseite auf **Zu offenen Positionen hinzufügen**.',
      '**Tagsüber** prüft die App alle 4 Stunden die offenen Positionen auf H4-Kerzen und sagt, was damit zu tun ist.',
      'Nach dem Schließen einer Position beim Broker klicken Sie im Portfolio auf **Position schließen** – das Ergebnis geht in Historie und Kapitalstatistik ein.',
    ],
  ] },
  { id: 'dashboard', title: 'Das Dashboard lesen', body: [
    '**Die Kacheln oben** beschreiben den gesamten Markt:',
    [
      '**Marktregime** – Trend, Rotation oder Seitwärts. Im Seitwärtsmarkt scheitern Ausbrüche häufig.',
      '**Klima** – Risk-on (starke Carry-Währungen: AUD, NZD, CAD) oder Risk-off (starke sichere Häfen: JPY, CHF, USD).',
      '**Ausführungsmodus** – offensiv, selektiv oder defensiv. Er ergibt sich aus dem Matrix Score.',
      '**W1/D1-Einklang** – Anteil der Tagessignale, die mit dem Wochenchart übereinstimmen.',
      '**Symmetrie** – Anteil der Währungssignale, die vom gesamten Währungskorb gestützt werden.',
      '**Portfoliorisiko** – OK, ACHTUNG oder SPERRE gemäß Ihren Limits.',
      '**Matrix Score** – Bewertung 0–100: ab 70 offensiv, ab 45 selektiv, darunter defensiv.',
    ],
    'Der **Entscheidungstrichter** zeigt, wie viele Instrumente nach jeder der neun Stufen übrig bleiben. Ein Klick auf eine Stufe zeigt in der Tabelle unten, was dort ausgeschieden ist.',
    '**Währungsstärke** ist der mittlere Ichimoku-Wert jeder Währung über alle ihre Paare (−10 bis +10). Die besten Paare stellen eine starke Währung gegen eine schwache.',
    'Der **Session-Verlauf** zeigt, welche Währung in der letzten Sydney-, Tokio-, London- und New-York-Session am stärksten und am schwächsten war. Das ist Kontext, kein Signal.',
    '**Risiken** sammeln Warnungen: verletzter Stopp, gedrehtes Signal, überschrittene Limits.',
  ] },
  { id: 'closed', title: 'Analyse nur auf geschlossenen Kerzen', body: [
    'Alle Bewertungen, Klassen und Entscheidungen werden **ausschließlich auf geschlossenen Tageskerzen** berechnet. Eine noch laufende Kerze bleibt unberücksichtigt – ihre Form ändert sich im Tagesverlauf, ein Signal könnte erscheinen und wieder verschwinden.',
    'Praktisch heißt das: **Die heutige Analyse beruht auf der Kerze von gestern** (der letzten geschlossenen). Eine neue Analyse entsteht erst nach Handelsschluss der jeweiligen Marktgruppe, zur in den Zeitgruppen eingestellten Uhrzeit.',
    'Auf der Instrumentenseite gibt es über dem Chart zwei Schaltflächen:',
    [
      '**Chart der Analyse** – genau die Kerzen, auf denen die Bewertung berechnet wurde. Dieser Chart begründet die Entscheidung.',
      '**Aktueller Chart** – dasselbe plus die noch laufende Kerze (nur als Umriss gezeichnet), mit frisch geladenen Daten. Er dient der Ansicht des aktuellen Geschehens; die Bewertungen ändert er nicht.',
    ],
    'Dieselbe Regel gilt für die Positionsführung: Die Empfehlungen alle 4 Stunden werden auf geschlossenen H4-Kerzen berechnet.',
  ] },
  { id: 'grades', title: 'Wert, Klassen und Entscheidungen', body: [
    'Jedes Instrument erhält einen **Ichimoku-Wert von −10 bis +10** auf D1 und auf W1. Er setzt sich zusammen aus: Kurs zur Wolke (±3), Tenkan zu Kijun (±2), Chikou (±2), Kurs zu Kijun (±1), Farbe der künftigen Wolke (±1), Kijun-Neigung (±1).',
    '**Chance 0–10** verbindet den D1-Wert, den Einklang mit W1 und die Symmetrie, abzüglich einer Strafe für Überdehnung (Kurs weit vom Kijun).',
    [
      '**Klasse A** – Hauptsetup: Chance mindestens 8, W1 im Einklang, Kurs und Chikou außerhalb der Wolke, saubere Symmetrie, nicht überdehnt, passend zum Klima.',
      '**Klasse B** – bedingtes Setup: Chance mindestens 6,5, kein Zeitrahmenkonflikt.',
      '**Klasse C** – Beobachtung: Richtung vorhanden, Qualität zu schwach.',
      '**Klasse D** – kein Trade.',
    ],
    'Entscheidung: **HANDELN** (A immer, B außer im defensiven Modus), **BEOBACHTEN** (C oder gesperrtes Portfolio), **WARTEN** (D).',
    'Das Zeichen **≈** neben einem Setup bedeutet Korrelation: Es handelt dieselbe Währung in dieselbe Richtung wie ein besseres Setup. Risiko nicht verdoppeln.',
  ] },
  { id: 'instrument', title: 'Die Instrumentenseite', body: [
    [
      '**Ichimoku-Chart** mit Umschalter D1 / H4 (H4 erscheint bei Instrumenten mit offener Position). Mit der Maus darüberfahren, um Werte zu lesen.',
      '**Weg durch den Trichter** – neun Stufen mit Status und Grund. Hier sehen Sie, warum ein Instrument ausgeschieden ist oder bestanden hat.',
      '**Plan** – Einstiegsbedingung, Ungültigkeitsniveau und vorgeschlagener Stopp, dazu Tenkan, Kijun, Wolke und ATR.',
      '**D1-Wert im Zeitverlauf** – wie lange die aktuelle Richtung schon besteht.',
      '**Bestandteile des Werts** für D1 und W1 – woraus sich die Bewertung genau ergibt.',
    ],
  ] },
  { id: 'positions', title: 'Positionen und Führung auf H4', body: [
    'Die Schaltfläche **Zu offenen Positionen hinzufügen** öffnet ein Ticket wie beim Broker: Richtung, Risiko in % des Kapitals und Stopp. Der Einstiegskurs wird beim Speichern aus der API abgerufen. **Das ist nur ein Listeneintrag** – die Order beim Broker geben Sie selbst auf.',
    'Alle 4 Stunden (00, 04, 08, 12, 16, 20 UTC) bewertet die App jede Position auf geschlossenen H4-Kerzen:',
    [
      '**HALTEN** – H4 und D1 stützen die Position.',
      '**STOPP NACHZIEHEN** – die Position liegt mindestens 1R im Gewinn; vorgeschlagener Stopp hinter dem H4-Kijun.',
      '**TEILGEWINN MITNEHMEN** – der Trend läuft, aber der Kurs ist stark überdehnt.',
      '**STOPP ENGER SETZEN** – H4 hat auf der falschen Seite des Kijun geschlossen oder das Tagessignal ist erloschen.',
      '**POSITION VERKLEINERN** – H4 voll gegen die Position, während D1 sie noch stützt.',
      '**SCHLIESSEN** – Stopp verletzt, Tagessignal gedreht oder H4 dagegen ohne D1-Unterstützung.',
    ],
    'Ein vorgeschlagener Stopp bewegt sich nur in Gewinnrichtung. **Vorgeschlagenen Stopp übernehmen** speichert ihn in der App – beim Broker ändern Sie ihn selbst.',
  ] },
  { id: 'capital', title: 'Positionen schließen und Kapital', body: [
    'Klicken Sie im Portfolio auf **Position schließen**. Der Ausstiegskurs wird aus der API vorgeschlagen – korrigieren Sie ihn auf den tatsächlichen Kurs. Sie können auch das genaue Ergebnis Ihres Kontos als Betrag eintragen.',
    'Ein Ergebnis in **R** ist Gewinn oder Verlust in Einheiten des Anfangsrisikos: +2R bedeutet einen Gewinn in doppelter Höhe des riskierten Betrags.',
    '**Einstellungen → Kapital** zeigt Start- und aktuelles Kapital, Gewinn, Durchschnitt je Trade, Trefferquote, Profitfaktor, maximalen Drawdown, die Kapitalkurve und eine Tabelle aller Trades.',
    'Das Ergebnis in Geld wird als Kapital vor dem Trade × Risiko % × Ergebnis in R berechnet. Spreads, Kommissionen und Swaps sind nicht enthalten.',
  ] },
  { id: 'settings', title: 'Einstellungen im Überblick', body: [
    [
      '**Zeitgruppen** – jeder Markt beendet seinen Tag zu einer anderen Zeit. Eine Gruppe hat Handelsschluss und Zeitzone; danach lädt die App Daten und analysiert die Instrumente dieser Gruppe.',
      '**Instrumente** – in Kategorien geordnet, die Sie mit einem Klick ein- und ausschalten. Ein eigenes Instrument fügen Sie mit dem Symbol der Datenquelle und einer Zeitgruppe hinzu.',
      '**Marktdaten** – Wahl der Quelle (standardmäßig Yahoo Finance, alternativ Twelve Data oder Stooq) und einer Ersatzquelle.',
      '**Ichimoku & Bewertung** – die Perioden 9 / 26 / 52 und die Bewertungsschwellen; hier schalten Sie auch H4- und Session-Analyse aus.',
      '**Benachrichtigungen** – SMTP, Bericht nach jeder Gruppenanalyse, Alarme zu neuen Setups und zu geänderten Empfehlungen für Positionen.',
    ],
  ] },
  { id: 'limits', title: 'Einschränkungen, die man kennen sollte', body: [
    [
      'Yahoo Finance ist eine inoffizielle Quelle: Sie kann ausfallen oder falsche Daten liefern. Bei verdächtigen Kerzen mit dem Chart Ihres Brokers vergleichen.',
      'Die Tageskerze für Währungen bei Yahoo endet um Mitternacht Londoner Zeit, nicht um 17:00 Uhr in New York.',
      'Metalle sind Terminkontrakte (z. B. Gold GC=F), keine Spotpreise.',
      'Kurse in der App können von den Kursen Ihres Brokers abweichen.',
      'Die App hat keine Anmeldung – betreiben Sie sie im lokalen Netz oder hinter einem passwortgeschützten Proxy.',
    ],
  ] },
];

export const HELP = { pl, de, en };
