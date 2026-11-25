# struttura.md — Assegnazioni Appuntamenti

## 1. Architettura Generale

**Pattern:** SPA Vanilla JS + Module Bundler Vite + PDF.js + ExcelJS + Firestore REST + Nominatim Geocoding

**Layer Applicativi:**

| Layer | Descrizione | File |
|-------|-------------|------|
| Entry Point UI | HTML principale e componenti di layout, topbar, toolbar e modale di riepilogo | `index.html` |
| Design System | Variabili CSS, tema scuro, stili custom dropdown selettore tecnici e z-index, responsive/PWA, accessibilità | `css/style.css` |
| Controller / Orchestrator | Gestione stato locale, eventi Drag & Drop, render tabelle, selettore custom, ottimizatore rotte `optimizeAssignments`, helper modali a11y, SW registration | `js/app.js` |
| PDF Parser | Estrazione e parsing token dai Work Order Open Fiber (Elecnor, Sertori, Sirti), normalizzazione apparati, estrazione telefoni, cluster AB/CD | `js/pdfParser.js` |
| PDF Parser — schede XME | Lettura del formato "SCHEDA INTERVENTO TECNICO" del nostro estrattore (una pratica per pagina, campi etichettati) | `js/pdfParser.js` |
| Excel Generator | Generazione file `.xlsx` identico al modello aziendale con celle orario formattate, sfondo tecnici, fill compatibili, marcatura "presa in carico" | `js/excelGenerator.js` |
| Distribuzione equa | Due orari di lavoro per tecnico per fascia (fascia + ora successiva, pausa pranzo esclusa), impianti al loro orario, guasti spostati dentro la fascia senza telefonata, limite giornaliero (modulo puro, testabile senza DOM) | `js/distribuzione.js` |
| Memoria appuntamenti | Identità stabile per WR, import per unione senza doppioni, scelta della copia locale/cloud da mostrare (modulo puro, testabile senza DOM) | `js/appuntamenti.js` |
| Formattatore descrizioni | Scrittura uniforme di indirizzo, operatore, apparati, impianto di terminazione (PTA/PTE) e tag GUASTO/BORCHIA/MIGRAZIONE (modulo puro, condiviso da parser, sito ed Excel) | `js/formattatore.js` |
| PWA Manifest | Manifest applicazione installabile (display standalone, icone, tema) | `public/manifest.webmanifest` |
| PWA Service Worker | Cache offline: network-first per navigazione, stale-while-revalidate per asset, esclusione API esterne | `public/sw.js` |
| PWA Icons | Icone PNG 192/512 + maskable generate per installazione | `public/icons/` |
| Dashboard Integrata | Gestione posizione di casa dei tecnici Android per i calcoli di percorso | `C:\Users\Rosti\Desktop\tchwrk2` |
| Deploy & Build | Configurazione Vite per GitHub Pages (base `./`, outDir `docs`, copia `public/`) | `vite.config.js` |
| Scripts Windows | Script batch per avvio server dev ed aggiornamento GitHub | `avvia_progetto.bat`, `aggiorna_github.bat` |

---

## 2. Flussi Dati Principali

1. **Upload Work Order PDF**:
   - L'utente trascina o seleziona uno o più PDF.
   - `pdfParser.js` riconosce il formato **per pagina**: se compare "SCHEDA INTERVENTO TECNICO" usa il parser schede (vedi §11), altrimenti il parser legacy dei Work Order Open Fiber (Elecnor / Sertori / Sirti).
   - Legacy: estrae il testo tramite `pdfjs-dist`, raggruppa le pagine per codice WR e ricava orario, cliente, telefono `(numero)`, indirizzo, comune, centrale/POP/TOH, operatore OLO, apparati (es. `cpe3` senza sfp inventato) e note.
   - `integraAppuntamenti()` (`js/appuntamenti.js`) unisce il risultato alla lista: entra solo ciò che non c'è già (chiave = WR), quindi **rimandare lo stesso PDF non crea doppioni** e le modifiche fatte a mano restano. Poi `collectComuni()` e `autoAssignGuasti(nuovi)` solo sui nuovi.

2. **Lettura Tecnici Attivi & Casa da Firestore**:
   - `fetchTecniciFromFirestore()` in `app.js` interroga le REST API di Firestore su `technicalwork-cloud`.
   - Recupera la lista dei tecnici Android attivi ed esclude utenti web, disattivati (`settings/hidden_tecnici`) e bannati (`settings/devices_names`).
   - Scarica le coordinate GPS `homeLat`, `homeLng` per l'ottimizzazione del percorso.

3. **Selettore Custom e Ricerca Tecnici**:
   - Ogni riga genera un selettore custom a discesa `.tech-select-container` con pannello di ricerca `.tech-filter-input`.
   - Permette di scegliere il tecnico o di digitare manualmente, inserendo la stringa formattata `[Nome] [Centrale/Comune] [Appalto]`.

4. **Ottimizzazione Rotte e Carburante (`⚡ Ottimizza Assegnazioni`)**:
   - Geocodifica gli indirizzi degli interventi tramite l'API di Nominatim (OpenStreetMap).
   - Calcola la distanza Haversine dalla posizione di casa di ciascun tecnico o dall'intervento precedente.
   - Applica un algoritmo nearest-neighbor bilanciato per assegnare ogni appuntamento al tecnico più idoneo per vicinanza e tempo.
   - Genera una modale di riepilogo con interventi assegnati e chilometri totali stimati.

5. **Gestione Tecnici, Presenze, Ruoli e Colori Custom**:
   - Modal custom (`#techManagerModal`, `role="dialog"` a11y) con ricerca in tempo reale.
   - Permette di spuntare la presenza/ferie del tecnico, assegnare il ruolo (`Normale`, `Guasti Cluster A/B`, `Guasti Cluster C/D` — dropdown visibile a tutti) e scegliere un colore dalla paletta Excel (`EXCEL_PALETTE`, 56 colori).
   - I dati vengono salvati in `localStorage` (`tw_tech_settings_v1`) e sincronizzati online su Firestore `settings/assegnazioni_web` (campo `data`), caricati all'avvio e scritti con debounce (800ms).
   - Il cambio di ruolo del tecnico valuta il cluster (`isGuastiRole`) e ripopola i comuni coerenti col nuovo ruolo.

6. **Configurazione Guasti per Tecnico (admin)**:
   - Modalità admin attivata da 10 click rapidi sul badge logo (`#logoBadge`, sessione in `localStorage` `tw_admin_session`).
   - Pulsante `🚨 Guasti` (`#btnOpenGuastiConfig`) apre il pannello: per ogni tecnico guasti si abilitano/disabilitano comuni e appalti via chip checkbox con salvataggio live.
   - I dati comuni/appalti per tecnico sono salvati in `localStorage` (`tw_comuni_v1`, `tw_appalti_v1`).
   - `loadCompaniesFromConfig()` scarica la lista aziende da `https://raw.githubusercontent.com/gmaclol/Technicalwork-Materiali/master/lists/config.json` con cache 24h (`tw_companies_config` / `tw_companies_config_time`); le nuove aziende vengono propagate anche ai tecnici guasti via `mergeCompaniesFromConfig()`.

7. **Upload PDF Guasti Cluster-Aware**:
   - `pdfParser.js` estrae anche l'`areaCd` dei guasti: regex `AREA[_\s]*CD\s*[-:\s]*\s*(AB|CD)` (varianti incluse) sul testo del Work Order (Tipo `79 - ASSURANCE`).
   - `collectComuni()` registra il comune nella mappa `comuniClusters` (persistita su Firestore) e lo abilita **solo** sui tecnici del cluster giusto (`guasti_ab` → AB, `guasti_cd` → CD); le attivazioni (Tipo `78/70`) senza `areaCd` non toccano i tecnici guasti.
   - `migrateComuniData()` (una tantum, chiave `tw_comuni_migration_v2`) azzera `comuniList`, `comuniClusters` e comuni/appalti dei tecnici guasti su Firestore per una riscansione pulita.

8. **Esportazione Excel**:
   - `buildWorkbook()` in `excelGenerator.js` costruisce il foglio **identico al modello ufficiale** (`Attività Technical Work Srl del.xlsx`): Calibri 11 mai grassetto, titolo e intestazioni rosse su giallo, larghezze colonne A 5.92 / B 52.60 / C 24.62, dati dalla riga 6, orari come **ora vera di Excel** (`h:mm`), **testi neri** su orario/descrizione/tecnico, altezza riga calcolata dal testo.
   - Colonna descrizione **bianca**; **grigio `A5A5A5` solo per i guasti**, **giallo `FFFF00` solo per gli spostamenti di fascia** (presa in carico in un'altra fascia), testo **rosso** per borchie e migrazioni. Colonna 3 col colore del tecnico.
   - `aggiungiFoglio()` costruisce lo stesso foglio dentro un workbook esistente (usato per i file di confronto) e `exportToExcel()` scarica il file dal browser (`Blob`/`<a download>`).
   - **Ogni fascia è stampata per ogni tecnico della giornata**: si stampano le righe degli interventi e, **per ogni tecnico che in quella fascia non ha niente, una riga "Altro appuntamento" con il nome del tecnico a destra** (col suo colore). I tecnici sono quelli che compaiono negli interventi da realizzare **più i tecnici presenti** passati da `app.js`: gli impianti (`tecniciAttivi`, ruolo `normale`) con "Altro appuntamento", i guasti (`tecniciGuasti`, ruolo guasti) con "**Guasti**" su sfondo grigio; chi ha già un intervento nella fascia non prende righe in più.
   - Colori fascia dal modello: 08:30 `FFFF0000`, 11:30 `FF00B050`, 14:30 `FFC55A11`, 16:30 `FF4472C4` (l'ora successiva della fascia usa lo stesso colore).
   - Sezioni *Sospendere* (3 posti per fascia) e *Chiudere* (4 per fascia) con i titoli e le righe di separazione del modello. Borchie e migrazioni restano con la descrizione rossa.
   - Verifiche: `test_excel.mjs` (17 controlli) e `work/confronta_stili.py` (confronto stile 1:1 col "vergine", zero differenze).

9. **PWA (installazione e offline)**:
   - `index.html` linka `manifest.webmanifest`, icone e meta (`theme-color`, `mobile-web-app-capable`, `apple-*`).
   - `initServiceWorker()` in `app.js` registra `./sw.js` a runtime.
   - `sw.js`: navigazione network-first con fallback cache; asset statici stale-while-revalidate; richieste a Firestore/Firebase/githubusercontent/fonts NON intercettate (restano online).

10. **Accessibilità (a11y)**:
    - Skip link `#main-content`; modali `role="dialog" aria-modal aria-labelledby` con focus trap e chiusura Escape (`openModal`/`closeModal`).
    - Selettore tecnici con pattern combobox/listbox/option (`aria-expanded` sincronizzato, ArrowDown/Escape/Enter).
    - Tabelle con `scope="col"` e caption; statistiche in `aria-live="polite"`; bottoni icona con `aria-label`; `:focus-visible` e `prefers-reduced-motion` in CSS.

11. **Lettura delle schede intervento (nostro estrattore XME)**:
    - Documento riconosciuto da `isSchedaDocument()` (presenza di "SCHEDA INTERVENTO TECNICO"); `splitSchede()` crea un blocco per pagina, accodando le eventuali continuazioni.
    - `parseScheda()` tokenizza il testo sulle spaziature ampie (`schedaTokens`) e legge le coppie `ETICHETTA: valore` con `schedaValue()`: `DATA INTERVENTO` (orario `HH:MM – HH:MM`), riga `INDIRIZZO – COMUNE`, `CLIENTE`, `TEL`, `TIPO PRATICA`, `JOB TYPE`, `OPERATORE`, `CENTRALE / POP`, `CODICE WR (OF)`, `COMUNE`, `TIPO INSTALLAZIONE`.
    - Tipo intervento: `ASSURANCE`/`GUASTO`/`DISSERVIZIO` → `Guasto`; `MIGRAZION`/`SUBENTRO` nel JOB TYPE → `Migrazione`; altrimenti `Attivazione`.
    - Telefono: preferisce un cellulare (`3xxxxxxxxx`), altrimenti il primo numero; `Nessun recapito telefonico` → vuoto.
    - Apparati: legge la sezione `APPARATI & CREDENZIALI IN CONSEGNA` (nome, `PASSWORD / SERVIZIO:`, etichetta d'azione); il segnaposto `Router / CPE Cliente` e i codici numerici vengono scartati; i nomi noti riusano `normalizeApparato()`, i nuovi restano com'erano sul portale.
    - Appalto: la scheda non lo stampa (entrambi i portali dicono "Elecnor WFM API"), si deduce dal nome file (`appaltoDaNomeFile`).
    - Cluster: la scheda non stampa `AREA_CD`; per i guasti `processPdfFiles()` in `app.js` lo ricava da `getClusterForComune()`.

12. **Distribuzione equa (`⚖️ Distribuisci equo`)**:
    - `distribuisciEquo()` in `app.js` prende i tecnici impianti (attivi, ruolo `normale`), gli impianti normali (`sezione === 'realizzare'`, guasti esclusi), le lavorazioni brevi (`sezione 'borchia'` o `'migrazione'`) e i guasti già presi in carico (tecnico ricavato da `nomeTecnicoDaStringa`), e chiama `pianificaDistribuzione()` di `js/distribuzione.js`.
    - Il modulo è puro. `postiDellaFascia()` dà due orari di lavoro per fascia: quello della fascia e quello un'ora dopo (08:30/09:30, 11:30/12:30, 14:30/15:30, 16:30/17:30).
    - Per ogni fascia si parte dalle **lavorazioni brevi** (guasti, borchie, migrazioni: sono interventi corti), poi si sistemano gli impianti normali. Per ogni fascia e per ogni tecnico: max 1 impianto e max 2 interventi in tutto (`maxImpiantiPerFascia`, `maxVociPerFascia`). Le brevi si **raggruppano** sullo stesso tecnico (due interventi veloci insieme), l'impianto va all'altro; la scelta segue anche il carico della giornata (brevi comprese) e il nome.
    - `pianificaDistribuzione()` calcola il piano **due volte** (brevi raggruppate e brevi bilanciate) e tiene quello con **meno interventi senza posto** e, a parità, **meno telefonate**: se raggruppare consuma il posto di un impianto si usa la versione bilanciata.
    - Un intervento resta al suo orario se può: le due brevi possono stare nella stessa ora (è lo schema del foglio ufficiale), l'impianto tiene la sua; se l'ora è presa da un impianto la breve usa l'altro orario della fascia (es. 12:30). Chi non entra nella fascia passa alla successiva (telefonata per impianti/borchie/migrazioni, niente per i guasti). Il limite `Max interv./tecnico` conta solo gli impianti.
    - `showDistribuzioneModal()` mostra l'anteprima (per tecnico e orario, `(GUASTO)`/`(BREVE)` sulle righe, "📞 Da spostare — chiamare il cliente", "🚨 Guasti spostati di un'ora", rientri e interventi senza posto) e applica solo su conferma (`applicaDistribuzione()`).
    - Gli interventi spostati ricevono `orarioOrigine`: **la presa in carico resta all'orario originale** (prioritaria sull'app Open Fiber), il lavoro è all'orario nuovo. La marca si vede nella tabella (`.presa-carico`) e nell'Excel come prefisso `(presa in carico HH:MM)`.
    - `applicaDistribuzione()` riscrive il tecnico solo sulle righe impianto/brevi; per i guasti tocca solo orario e presa in carico (il tecnico lo decide il cluster).
    - Il piano parte dalla presa in carico (`_origine`), non dall'orario attuale: chi ritrova posto all'origine finisce nei **rientrati** (nessuna telefonata). Test: `test_distribuzione.mjs` (34 controlli).

13. **Memoria degli appuntamenti (refresh e dispositivi)**:
    - Stato in `appuntamenti` (RAM) + `localStorage` (`tw_appuntamenti_v1`) + documento Firestore **`settings/assegnazioni_appuntamenti`** (campo `data`, JSON della lista). `salvaAppuntamenti()` scrive subito in locale e, dopo 800 ms, sul cloud solo se il JSON è cambiato (`_firmaAppuntamenti`); è chiamata da `renderTables()` (punto unico di ogni modifica) e dai pochi handler che non ridisegnano (selezione tecnico, commit dei campi di testo).
    - All'avvio `loadTecnici()` chiama `caricaAppuntamenti()` **prima** di assegnare i guasti: `unisciCopieAppuntamenti()` usa la copia online (vince) e vi aggiunge gli interventi presenti solo in locale (import fatto offline).
    - `autoAssignGuasti(nuovi)` salta i guasti che hanno già un tecnico, così le assegnazioni decise a mano non vengono rifatte.
    - `🗑️ Svuota Lista` azzera la lista e la copia online (nuovo stato di partenza per tutti i dispositivi). Test: `test_appuntamenti.mjs` (18 controlli).
    - `⚖️ Distribuisci equo` non conserva piani: rilegge la lista a ogni click, quindi cambiare il pallino e rilanciare basta per ricalcolare.

