# decisions.md — Assegnazioni Appuntamenti

## Stack e Vincoli — Assegnazioni Appuntamenti

Stack:
- **Piattaforma / Hosting**: GitHub Pages (`docs/` folder) — **Zero Costo**.
- **Frontend**: Vanilla JavaScript (ES modules, HTML5, CSS3 Custom Properties).
- **Build Tool**: Vite 5.x.
- **Parsing PDF**: `pdfjs-dist` (estrazione dati client-side e parsing intelligente in-memory dai PDF Open Fiber).
- **Generazione Excel**: `exceljs` (costruzione workbook `.xlsx` speculare al formato di lavoro Technical Work Srl).
- **Integrazione Database**: Firestore REST API (`technicalwork-cloud`) per recupero lista e coordinate casa dei tecnici senza SDK pesante in frontend.
- **Geocodifica & Routing**: Nominatim OpenStreetMap API + Algoritmo Haversine per ottimizzazione percorso e carburante.

Vincoli:
- **Budget**: Zero-costo.
- **Privacy & Sicurezza**: Nessun server esterno di backend proprietario, il parsing dei PDF avviene interamente nel browser locale dell'utente per garantire velocità istantanea.
- **Lingua di Lavoro**: Italiano.

---

## 2026-08-01 — Avvio Progetto Assegnazioni Appuntamenti

**Motivazione:**
Automazione del processo quotidiano di estrazione dati dai PDF Work Order di Open Fiber (Elecnor, Sertori, Sirti, ecc.) per organizzare e assegnare gli appuntamenti ai tecnici e generare l'Excel giornaliero per la direzione.

**Decisioni:**
- **Parsing in-memory dei PDF**: Usare `pdfjs-dist` nel browser per estrarre token di testo, identificando Work Order (WR), Tipo Intervento, Orario, Cliente, Telefono, Indirizzo, Operatore (OLO), Apparati (Modem, ONT, Borchia), Lavorazioni speciali (scavi, PTE/PTA pozzetto/facciata/palo) e Note.
- **Formattazione Descrizione Intervento**: Standardizzata in `INDIRIZZO (NUMERO_TELEFONO) OPERATORE APPARATI ORARIO` (es. `VIA BORGONE 9 (3334704516) iliad cpe3 08:30`).
- **Normalizzazione Apparati**: Corretto il parser per non aggiungere fittiziamente `+ sfp` quando l'apparato estratto è `CPE3`.
- **Logica Centrale / POP / TOH**:
  - `FCO` (es. `TO/FCO/2`) -> estrae ed imposta `pop2` (o `pop1`, `pop3` ecc.)
  - `TOH` (es. `TOH_1-`) -> estrae ed imposta `toh1` (o `toh2`, `toh3` ecc.) sia per Torino che per altri comuni (es. Rivoli).
  - Altrimenti -> imposta il nome del comune normalizzato (es. `Asti`, `Candelo`).
- **Selettore Custom Tecnici (UI)**: Componente grafico dedicato con campo di ricerca in tempo reale per selezionare i tecnici Android attivi da Firestore, sovrapposto con z-index elevato per evitare tagli con le righe sottostanti.
- **Ottimizzazione Rotte (`⚡ Ottimizza Assegnazioni`)**: Algoritmo greedy nearest-neighbor basato su distanza Haversine che geocodifica gli indirizzi degli interventi, legge le coordinate della casa dei tecnici dal tab "Casa" di `tchwrk2` e assegna gli appuntamenti in ordine cronologico minimizzando chilometri e consumo di carburante con penalità di bilanciamento carico.
- **Export Excel Automatizzato**: Esportazione `.xlsx` con testo orario in nero grassetto su sfondo colorato per massima leggibilità.

---

## 2026-08-02 — Estensioni Guasti Cluster AB/CD, Ruoli Specializzati, Borchia e Gestione Aziende

**Decisioni:**
- **Auto-Assegnazione Guasti AB/CD**: Parsing automatico della dicitura `AREA_CD - AB` e `AREA_CD - CD` (e varianti) nei PDF dei guasti per pre-assegnare automaticamente l'intervento al tecnico configurato col ruolo `Guasti Cluster A/B` o `Guasti Cluster C/D` senza interventi manuali.
- **Sezione Realizzare e Posizionamento Guasti**: I guasti **rimangono nella sezione Impianti da Realizzare** (non vanno in Chiudere). Vengono ordinati primariamente per orario, e **all'interno della stessa fascia oraria vengono posizionati in fondo alla fascia, compatti tra loro**.
- **Esclusione Rotte Impianti & Carico Guasti Illimitato**: I tecnici con ruolo guasti vengono esclusi dall'ottimizzazione automatica delle rotte degli impianti da realizzare (soggetti al cap `maxInterventiPerTecnico`) ed i guasti estratti vengono loro assegnati automaticamente in **numero illimitato**, potendo gestirne anche 20+ al giorno per la minore durata media dell'intervento.
- **Sezione Borchia & Visualizzazione**: L'opzione `Borchia` aggiunta al dropdown di riga fa apparire l'intervento nella tabella `Realizzare` del sito in ordine cronologico evidenziandolo in testo rosso. In Excel, evidenzia in **rosso unicamente la cella della descrizione** (colonna 2), lasciando orario e tecnico in font nero standard.
- **Visualizzazione Guasti**: I guasti sono evidenziati sia sul sito con sfondo grigio scuro (`#2a3547`) sia in Excel su tutte e 3 le colonne con sfondo grigio (`#C0C0C0`), preservando il colore di fascia oraria sulla cella A.
- **Gestore Dinamico Aziende**: Inserito un dropdown per la scelta dell'azienda di appalto per ciascuna riga della tabella ed un gestore grafico nella topbar (**🏢 Aziende**) con persistenza delle aziende personalizzate in `localStorage` (`tw_companies_v1`).

---

## 2026-08-03 — Persistenza Online Impostazioni Tecnici Web

**Decisioni:**
- **Salvataggio online colore/ruolo/presenza tecnici**: Aggiunto documento Firestore dedicato `settings/assegnazioni_web` (campo `data` = JSON con `nome → { active, role, color }`) per salvare le impostazioni dei tecnici gestite dal sito e sincronizzarle tra browser/dispositivi.
- **Zero conflitti**: Il documento è di sola proprietà del sito Assegnazioni Appuntamenti; nessun altro componente (app Android, dashboard `tchwrk2`) lo legge o scrive. Non si tocca `settings/devices_names`, che resta il registro condiviso con Android/dashboard.
- **localStorage come cache**: `localStorage` (`tw_tech_settings_v1`) resta la cache veloce; all'avvio le impostazioni online (se presenti) sovrascrivono quelle locali; ad ogni modifica il salvataggio online è debounceato (800ms) per evitare write-amplification dal color picker (eventi `input` continui).

---

## 2026-08-03 — Guasti Cluster-Aware, Config Comuni/Appalti per Tecnico e Appalti da GitHub

**Decisioni:**
- **Modalità Admin segreta**: 10 click rapidi sul badge logo (`#logoBadge`) attivano l'admin con classe `.logo-badge.admin` (gradiente rosso/arancio); sessione persistita in `localStorage` (`tw_admin_session`). Nessun popup/prompt.
- **Pannello Config Guasti admin-only**: pulsante `🚨 Guasti` (`#btnOpenGuastiConfig`) visibile solo in admin; per ogni tecnico con ruolo guasti si configurano via chip checkbox i **comuni** e gli **appalti** coperti, con salvataggio live. Comuni e appalti restano per-browser (chiariti i campi su Firestore in risposta a dubbio di `lastWrite`).
- **Cluster AB/CD verificati come dominio reale**: La scansione dei PDF di esempio (`context_study/`) conferma che i guasti (Tipo `79 - ASSURANCE`) riportano `AREA_CD - AB` (Torino/Asti/Biella) o `AREA_CD - CD` (provincia). Le attivazioni (Tipo `78/70`) non hanno cluster → nessuna registrazione. L'abilitazione del comune avviene **solo** sui tecnici del cluster giusto (`guasti_ab` → AB, `guasti_cd` → CD).
- **`comuniClusters` su Firestore**: mappa `comune → cluster` persistita sul documento `settings/assegnazioni_web` per la riscrittura post-migrazione.
- **Appalti da GitHub config.json**: `loadCompaniesFromConfig()` recupera le aziende da `https://raw.githubusercontent.com/gmaclol/Technicalwork-Materiali/master/lists/config.json` con cache 24h in `localStorage` (`tw_companies_config`, `tw_companies_config_time`), pattern già usato in `tchwrk2`; le nuove aziende vengono propagate anche ai tecnici guasti (`mergeCompaniesFromConfig`).
- **Migrazione pulizia comuni (`migrateComuniData`)**: una tantum (chiave `tw_comuni_migration_v2`) azzera `comuniList`, `comuniClusters` e i comuni/appalti dei tecnici guasti, sincronizzando il vuoto su Firestore per una riscansione pulita dei PDF senza doppioni da versioni pre-cluster.

---

## 2026-08-04 — PWA, Accessibilità e Colori Excel

**Decisioni:**
- **PWA installabile**: aggiunto `public/manifest.webmanifest` (display `standalone`, theme `#0f172a`, icone 192/512 + maskable generate via System.Drawing), Service Worker `public/sw.js` (network-first per la navigazione con fallback cache, stale-while-revalidate per gli asset statici, esclusione esplicita di Firestore/API esterne che restano online), registrazione in `initServiceWorker()`. Deploy sempre via `docs/` (Vite copia `public/`).
- **Accessibilità a11y**:
  - Skip link "Salta al contenuto" + landmark `main#main-content`.
  - Modali come `role="dialog" aria-modal="true" aria-labelledby` con focus trap (Tab/Shift+Tab), chiusura con Escape e ripristino del focus sul pulsante di apertura (helper `openModal`/`closeModal`, `aria-hidden` gestito).
  - Selettore tecnici come `role="combobox"`/`listbox`/`option` con `aria-expanded` sincronizzato, apertura con ArrowDown, Escape, selezione con Enter.
  - `aria-label` su bottoni icona (delete-row, color, chiudi, aziende, logo admin), input nascosti (file, ricerca, tecnico); `scope="col"` e caption sulle tabelle; `aria-live="polite"` sulle statistiche.
  - Stili `:focus-visible` globali e `@media (prefers-reduced-motion: reduce)`.
- **Colori Excel compatibili con la palette del programma**: ogni fill solido (`solidFill`) include `fgColor` + `bgColor: { indexed: 64 }` perché alcune versioni di Excel non applicano il colore senza `bgColor` e mostrano la cella bianca. Matching tecnico→colore robusto: primo membro della squadra, nomi composti case-insensitive (niente regex fragili).
- **Color picker a palette Excel**: picker nativo sostituito da `EXCEL_PALETTE` (56 colori ColorIndex classici) per garantire che i colori scelti siano identici a quelli che Excel mostra; popup window-aware (clamp orizzontale + flip verticale), z-index 100010 sopra le modali.
- **Responsive / PWA screen-fit**: `overflow-x: hidden` globale; topbar wrap sotto 1100px; layout compatto in `@media (display-mode: standalone)`; breakpoint 720px con scroll orizzontale touch delle tabelle (min-width 720px) e modali full-width. I dropdown restano sopra grazie a `z-index`.
- **Meta tag**: aggiunto `mobile-web-app-capable` (e mantenuto `apple-mobile-web-app-capable` solo per compatibilità iOS, dove non è deprecato).

