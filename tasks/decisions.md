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

---

## 2026-11-17 — Lettura delle schede intervento del nostro estrattore XME

**Motivazione:**
Il sito leggeva solo i Work Order legacy Open Fiber (`WR: … Indiriz.: …`). Le schede "SCHEDA INTERVENTO TECNICO" prodotte dal nostro estrattore (`pratiche_*.pdf`, `sertori_*.pdf`, `elecnor_*.pdf`) non venivano lette, pur contenendo già tutti i dati utili alla giornata.

**Decisioni:**
- **Rilevamento per pagina, non per file**: `isSchedaDocument()` decide il parser dalla presenza di "SCHEDA INTERVENTO TECNICO"; il ramo legacy resta identico (nessuna regressione sui PDF già in uso, verificato su `context_study/`).
- **Tokenizzazione sulle spaziature ampie**: nel testo estratto da PDF.js ogni campo è separato da spaziature multiple, quindi la pagina si legge come sequenza `ETICHETTA:` → valore. Più robusto di una regex posizionale e indipendente dall'ordine dei campi.
- **Apparati anche sui guasti**: sulla scheda la sezione `APPARATI & CREDENZIALI IN CONSEGNA` è già il risultato dell'estrazione del portale, quindi viene usata anche per i guasti (nel legacy era scartata perché inaffidabile). Il segnaposto `Router / CPE Cliente` (nessun apparato da prelevare) viene escluso.
- **Nomi apparato**: si riusa `normalizeApparato()` del legacy per le tipologie note, così la descrizione resta coerente (`cpe3`, `ont 2.5 G`, `modem seven`); le tipologie nuove mantengono il nome del portale (`CPE_PLE_2.5G`, `CPECOC_GEHX30`) invece di essere perse.
- **Telefono**: si preferisce il cellulare (`3xxxxxxxxx`), altrimenti il primo numero. Sulla scheda i recapiti sono elencati in ordine variabile e il cellulare è quello che serve al tecnico.
- **Appalto dal nome file**: la scheda non stampa l'appalto (il footer dice "Elecnor WFM API" per entrambi i portali). `appaltoDaNomeFile()` mappa `sertori`/`sirti`, altrimenti `Elecnor`; la riga resta comunque correggibile dal selettore azienda.
- **Cluster AB/CD**: la scheda non contiene `AREA_CD`. Per i guasti `processPdfFiles()` recupera il cluster da `getClusterForComune()` (mappa comuni→cluster già persistita), senza toccare `collectComuni()`.
- **`tipoImpianto`** estratto da `TIPO INSTALLAZIONE` con il vocabolario legacy (`pte`, `pta pozzetto`, `pta facciata`, `pta palo`).

---

## 2026-11-22 — Vocabolario apparati aggiornato (codici materiale e modelli nuovi)

**Motivazione:**
Nella lista appuntamenti i modem consegnati come codice materiale (es. via Govone 23/11: `785632`) sparivano: il parser scartava i valori numerici come "codici modem", quindi la riga mostrava solo l'operatore e l'ONT.

**Decisioni:**
- **I codici materiale numerici (5-7 cifre) sono apparati**: non vengono più scartati. `785632` → `tim hub pro` e `784010` → `tim vision` (tabella `CODICI_MATERIALE`); i codici non noti (es. `781093`) restano stampati così come sono, come già fa l'exporter svizzero: i tecnici li riconoscono. **Confermato dall'utente il 22/11/2026 per `781093`.**
- **Tipologie nuove mappate** (`APPARATI_PORTALE`, in aggiunta alle regole storiche lasciate intatte): `MODEM_MIG` → `modem mig`, `EXTENDER_SEVEN` → `extender seven`, `EOLOROUTER-WIFI7` → `eolo router wifi 7`, `CPE_INT_MB_2.5` → `Cpe_int_mb_2.5`, `CPE_INT` → `Cpe_int`, `CPE_2.5`/`CPE_PLE_2.5G`/`CPE_CP_2.5` → `Cpe_2.5` (stesso modem ZTE 6745P, come da analisi `scratch/analysis/apparati`), `CPE_POSTE_2.5` → `Cpe_post_2.5`, `CPE_TIS_2.5` → `Cpe_tis_2.5`, `CPE` → `cpe`, `ONT`/`ONT_<seriale>` → `ont`.
- **Apparati del cliente**: la scheda marca i materiali che non si prelevano con il suffisso `· solo installazione` (o `· solo consegna`); il suffisso viene tolto dal nome e sostituito da `(cliente)` / `(solo consegna)`, così restano visibili senza sembrare da magazzino.
- **Niente falsi codici**: dopo `PASSWORD / SERVIZIO:` il token è la password (es. `8794170` a 7 cifre) e non può diventare un apparato: in quella posizione si accetta solo il nome di un apparato accodato alla password (`25286055 ONT_OF_2.5G`).
- **OLO**: aggiunto `TELECOM ITALIA SPA` → `tim` (stesso operatore, nome lungo del portale).
- **Telefoni: tutti e nello stesso ordine della scheda** (`3356977351 / 0159131441`), non più il solo primo. Sulla scheda i recapiti sono in ordine variabile (a volte prima il fisso), quindi filtrare "il cellulare" falsava il dato rispetto al PDF; si riportano tutti, deduplicati, con ` / `. Nel legacy si leggono `RECAPITO_TELEFONICO_CLIENTE_1..N` (spesso lo stesso numero ripetuto) con fallback su `Telefono Reclamante`. Un campo che va a capo dopo la `/` recupera il numero nel token successivo.
- **Exporter verificato sul server**: `xme_pdf_exporter` è attivo e la copia deployata (`/srv/docker/xme_pdf_exporter/swiss_export_service.py`, md5 `723d62af…`) è identica al mirror `homeserver/scratch/xme_live/`. L'exporter stampa le tipologie grezze e conosce come TIM solo `785632`/`784010` (rank 30/31; `781093` finisce in "altro"), quindi la traduzione in nomi leggibili resta a carico del sito, non dell'exporter.




---

## 2026-11-22 — Distribuzione equa degli impianti e "presa in carico" all'orario originale

**Motivazione:**
Le pratiche arrivano con fasce orarie casuali e capitava che lo stesso tecnico avesse più impianti nella stessa fascia mentre un collega restava fermo. L'ufficio ha chiesto una distribuzione equa (un impianto per tecnico per fascia) e che gli spostamenti siano scritti in chiaro, perché sull'app Open Fiber la presa in carico è prioritaria e il lavoro si esegue in un altro orario solo con il consenso del cliente.

**Decisioni:**
- **Nuovo modulo puro `js/distribuzione.js`** (`pianificaDistribuzione`): niente DOM, così è verificabile in Node sui dati reali. Una sola assegnazione per tecnico per fascia; i tecnici sono ordinati per carico crescente (equità) e poi per nome, per avere un piano ripetibile.
- **I guasti restano dell'exporter/cluster**: non vengono ridistribuiti, ma occupano la fascia del tecnico che li ha. Così, se alle 08:30 ci sono 2 impianti e 1 guasto con 2 tecnici, chi ha il guasto prende l'impianto alle 09:30 e l'altro prende l'impianto alle 08:30.
- **Spostamento a +1 ora**, non a salti: le fasce candidate sono quelle reali più le ore successive fino alle 18:30, così un impianto del 08:30 va in 09:30 e non a 11:30. Un impianto già presente nella fascia di arrivo non viene sfrattato.
- **Anteprima con conferma** (`showDistribuzioneModal`): il piano si applica solo con "Applica distribuzione", perché gli spostamenti implicano telefonate ai clienti. La modale elenca per tecnico e fascia, gli spostamenti con "da dove a dove" e gli impianti che restano senza posto per il limite giornaliero.
- **Presa in carico ≠ lavoro**: sugli interventi spostati si salva `orarioOrigine`; `orario` resta l'orario di lavoro. La marca compare nella tabella del sito (badge arancione `presa in carico HH:MM`) e nell'Excel come prefisso `(presa in carico HH:MM)` nella descrizione, perché la scheda stampata deve dirlo.
- **Rieseguibilità**: un secondo calcolo non deve segnalare come "spostato" ciò che era già spostato (`_fasciaAttuale` = fascia del giro corrente, `_origine` = presa in carico originale). Verificato con test di idempotenza.
- **`⚖️ Distribuisci equo` è separato da `⚡ Ottimizza Assegnazioni`**: il nuovo pulsante non usa geocodifica né le coordinate di casa (distribuzione per equità, non per vicinanza); l'ottimizzazione per percorsi resta com'era.
- **Il piano parte dalla fascia di presa in carico, non dalla posizione attuale**: gli impianti si raggruppano per `orarioOrigine` (la presa in carico) e solo dopo si assegna. Così, se una fascia si libera (tipico: un impianto delle 08:30 va in sospensione), al ricalcolo l'impianto spostato alle 09:30 **rientra** alle 08:30 e il badge di presa in carico sparisce. La modale elenca i rientri (verde) separatamente dalle telefonate da fare (arancione).

---

## 2026-11-22 — Colori Excel: grigio solo ai tecnici dei guasti, colore tecnico anche su borchia

**Motivazione:**
Nell'Excel il colore del tecnico "sbagliava" in due casi: le righe marcate `Borchia` restavano **senza** colore (lo sfondo del tecnico era saltato) e ogni riga di guasto diventava **grigia** anche quando il guasto lo faceva un tecnico normale (Stefano/Riccardo), perdendo il colore che lo identifica.

**Decisioni:**
- **Grigio = tecnico addebitato ai guasti**: lo sfondo `#C0C0C0` si applica solo se il tecnico della riga ha ruolo `Guasti Cluster A/B` o `C/D` (`buildGuastiTechSet()` in `app.js`, passato a `exportToExcel()` come `guastiTechs`). I tecnici normali che fanno anche guasti mantengono il loro colore; il guasto resta riconoscibile dal `(GUASTO)` in descrizione.
- **Borchia**: resta rossa solo la descrizione (comportamento confermato), ma la colonna 3 torna a mostrare il colore del tecnico.
- **Riconoscimento nome tecnico centralizzato** in `nomeTecnico()`: dalla stringa `[Tecnico] [Località] [appalto]` si ricava il nome (primo membro delle squadre, nomi composti più lunghi prima); lo usano sia lo sfondo del tecnico sia il test "è un tecnico guasti". Un nome non riconosciuto non colora la cella, come prima.
- **Virgola dopo l'operatore** nella descrizione quando seguono gli apparati: `... sky, ont sky of + hub6 ok` separa gestore e materiali. Sui guasti resta senza virgola perché non seguono apparati (`wn (GUASTO) ok`). Modificato in `pdfParser.js` e nel formatter gemello di `app.js`: vale per le righe importate da ora in poi.

---

## 2026-11-22 — Selettore colore libero nella Gestione Tecnici (tinte + HEX)

**Motivazione:**
La paletta Excel a 56 colori non bastava: servivano tinte più precise e la possibilità di incollare il codice di un colore aziendale.

**Decisioni:**
- **Selettore stile Photoshop, senza dipendenze**: anello delle tinte (`conic-gradient`) con pallina trascinabile + quadrato saturazione/luminosità al centro + anteprima, campo **HEX** (accetta `#RGB` e `#RRGGBB`) e pulsante Applica. Sotto resta la **paletta Excel a 56 colori** per le scelte rapide: un click colora e chiude come prima.
- **Conversione colore in funzioni pure** (`hexToRgb`, `rgbToHex`, `rgbToHsv`, `hsvToRgb`, `clamp01`) così sono verificabili senza DOM: test di andata/ritorno su 15 colori e casi noti (rosso, grigio, 120°/240°).
- **Drag con `pointer events` + `setPointerCapture`** (`touch-action: none`) così il trascinamento continua anche uscendo dal controllo e funziona su touch; palline e knob con `pointer-events: none`.
- **Accessibilità**: anello e quadrato sono `role="slider"` con `tabindex`, `aria-valuenow`/`aria-valuetext` aggiornati, frecce per tinta (Shift = passi grandi) e per saturazione/luminosità, Invio nel campo HEX applica.
- **Colori arbitrari in Excel**: non serve più stare dentro la paletta ColorIndex — il riempimento è comunque `FF` + HEX RGB, che Excel riproduce identico. La paletta resta solo come scorciatoia.
- Il popup mantiene il posizionamento window-aware (clamp orizzontale + flip verticale, `z-index 100010`) e ora ha `max-height: 82vh` con scroll per i telefoni.

---

## 2026-11-22 — Colori tecnici allineati al file modello ufficiale

**Motivazione:**
L'ufficio usa un Excel "vergine" con i colori dei tecnici già impostati; il sito ne usava altri, quindi il file generato non era riconoscibile a colpo d'occhio.

**Colori letti da `Attività Technical Work Srl del.xlsx` (colonna TECNICO/CENTRALE) e assegnati:**

| Voce nel modello | Colore | Tecnico nel sito |
| :--- | :--- | :--- |
| `Stefano Asti elecnor` | `#7030A0` | Stefano (era `#800080`) |
| `Marco + Mohamed` | `#00B0F0` | Marco Gentile (era `#0066CC`) |
| `Lombardo` | `#FFFF00` | LOMBARDO (già uguale) |
| `Enzo` | `#FF0000` | non presente tra i tecnici del sito |
| altri | nessun colore | invariati (Riccardo `#CC99FF`, ecc.) |

Assegnati scrivendo solo il campo `data` di `settings/assegnazioni_web` (PATCH con `updateMask=data`), senza toccare comuni/cluster/appalti. Verificato rileggendo il documento e generando un xlsx di prova.

- **Squadre con il solo nome di battesimo**: nel modello compaiono "Marco + Mohamed" e "Matias + Francesco"; il nome del tecnico ora viene riconosciuto anche quando la squadra riporta solo il nome (se il candidato è unico, nessuna ambiguità), così la squadra prende il colore del caposquadra.
- **Nota**: `Lombardo` ha ruolo Guasti AB, quindi nell'Excel le sue righe restano **grigie** per la regola "grigio solo ai tecnici dei guasti": il giallo salvato si vede solo se il ruolo torna `Normale`.

---

## 2026-11-22 (correzione) — Colori tecnici dal file modello: erano colori a tema

**Errore nella lettura precedente:** il primo script leggeva solo i riempimenti in RGB diretto. Metà delle celle del modello usa **colori a tema** (`fgColor.type = "theme"` con `theme` 2/5/6/7/9 e `tint`), che in openpyxl hanno `rgb = None`: risultavano "senza colore". Risolvendo `theme` sulla `clrScheme` del file e applicando il `tint` in spazio HLS si ottengono i colori reali.

**Mappatura completa (file modello → tecnico del sito):**

| Nel modello | Colore | Tecnico | Note |
| :--- | :--- | :--- | :--- |
| `Marco + Mohamed` | `#00B0F0` | Marco Gentile | RGB diretto |
| `Matias + Francesco` | `#A5A5A5` | Matias | theme 6 |
| `Alessio` | `#FBE5D6` | alessio | theme 5, tint 0.8 |
| `Martin` | `#806000` | martin | theme 7, tint −0.5 |
| `Riccardo Asti elecnor` | `#FFC000` | Riccardo | theme 7 |
| `Stefano Asti elecnor` | `#7030A0` | Stefano | RGB diretto |
| `Lombardo` | `#FFFF00` | LOMBARDO | RGB diretto |
| `Cristian` | `#70AD47` | Cristian | theme 9 |
| `Claudio` | `#E7E6E6` | Claudio | theme 2 |
| `Carmelo` `#ED7D31`, `Enzo` `#FF0000` | — | **non esistono nel sito** | da aggiungere a mano se servono |
| `Piero sertori` / `Piero elecnor` | nessun colore | Piero | resta com'è |

Assegnati con PATCH del solo campo `data` di `settings/assegnazioni_web`. Verificato generando un xlsx di prova: tutti i nomi escono col colore del modello.

**Da decidere con l'utente:** `Cristian` e `Lombardo` hanno ruolo guasti, quindi le loro righe escono **grigie** (regola "grigio solo ai tecnici dei guasti") e il colore del modello non si vede. Le due richieste sono in conflitto: opzione A mantenere il grigio, opzione B usare i colori del modello come nel file ufficiale.
- **SUPERATO il 22/11 (scelta dell''utente): niente più sfondo grigio.** Il grigio ai tecnici dei guasti è stato rimosso: nell''Excel ogni riga usa il colore del tecnico, come nel file modello ufficiale (Cristian `#70AD47`, Lombardo `#FFFF00` anche sulle righe guasto). Il guasto resta riconoscibile dal `(GUASTO)` in descrizione. Codice: rimossi `guastiTechs`/`isTecnicoGuasti` da `excelGenerator.js` e `buildGuastiTechSet()` da `app.js`.
- **Corrispondenze di nome con il file modello**: `Carmelo` nel file = **Melos** nel sito (`#ED7D31`), `Enzo` nel file = **Tamaenzo** nel sito (`#FF0000`). Assegnati il 22/11. Senza una nota questi due sarebbero rimasti "tecnici non esistenti".
- **Ripulita la voce fantasma** `d77808aa66d7bca2` (ID dispositivo di Piero finito tra i tecnici) anche dal documento `settings/assegnazioni_web`: ora le impostazioni contengono solo i 15 tecnici reali.

---

## 2026-11-22 — Nuovo stato riga "🟣 Migrazione" (automatico, come la borchia)

**Motivazione:**
Le migrazioni andavano marcate a mano come borchia per farle uscire con la descrizione rossa. Ora hanno un pallino dedicato e vengono riconosciute dal parser.

**Decisioni:**
- **Stato `sezione: 'migrazione'`**: assegnato automaticamente in `pdfParser.js` quando `tipoIntervento === 'Migrazione'` (sia schede sia legacy). Voce `🟣 Migrazione` nel menu di riga, dopo `🔵 Borchia`.
- **Stesse caratteristiche della borchia**: compare nella tabella/sezione *Impianti da realizzare* (ordine cronologico), testo rosso sul sito (`.row-migrazione`, stesse regole CSS di `.row-borchia`) e descrizione rossa in Excel (`addDataRow({ descrizioneRossa })`, ex `isBorchia`, ora usato da borchia e migrazione).
- **Continua a essere lavoro assegnabile**: a differenza della borchia, la migrazione è un intervento pieno, quindi entra in `⚡ Ottimizza` e in `⚖️ Distribuisci equo` (i filtri sono stati estesi a `sezione === 'migrazione'`), così il comportamento rispetto a prima — quando era `realizzare` — non cambia.
- Le righe già importate nella sessione non cambiano stato: il riconoscimento avviene al caricamento del PDF.

---

## 2026-11-22 — Presa in carico gestibile a mano e modifica orario solo alla conferma

**Motivazione:**
La presa in carico era un'etichetta automatica non modificabile; inoltre modificare l'orario spostava la riga al **primo carattere digitato** (la tabella si ridisegnava a ogni `input`), rendendo praticamente impossibile riscrivere l'ora.

**Decisioni:**
- **Presa in carico editabile/creabile/eliminabile**: nella cella orario c'è ora un mini campo (`data-field="orarioOrigine"`, arancione) con ✕ per toglierla e, quando manca, un pulsante `+ presa in carico` che la crea partendo dall'orario di lavoro. Valori accettati `8:30`, `8.30`, `08:30` (`normalizzaOrario`), vuoto = nessuna presa in carico. Se coincide con l'orario di lavoro viene scartata (non è uno spostamento).
- **La tabella si ridisegna solo su conferma**: gli handler dei campi salvano il testo a ogni tasto ma ricollocano la riga solo su `change` (Invio o click fuori); Invio fa `blur()` per chiudere la modifica. Gli orari si validano al commit: valore non valido → torna al precedente.
- **Service worker disattivato su localhost**: in locale la cache SW serviva la versione vecchia del sito (capitato con `avvia_progetto.bat` spento). Su `localhost`/`127.0.0.1` non viene registrato e quello eventualmente presente viene disregistrato; sul sito online resta attivo.
- **La presa in carico si crea da sola quando sposti la riga**: modificando l''orario (`applicaOrario()`), se la riga non era mai stata spostata l''orario di partenza diventa la presa in carico (`08:30 → 09:30` scrive `presa in carico 08:30`); spostandola ancora resta l''origine iniziale; **riportandola al suo posto la scritta sparisce**. Il campo resta comunque editabile/eliminabile/creabile a mano (`applicaOrario` non sovrascrive una presa in carico già presente, che è quella decisa da te o dal distribuisci). Verificato con 9 casi automatici.

---

## 2026-11-22 — Fasce orarie con divider e trascinamento delle righe

**Motivazione:**
Ordinare la giornata con il solo campo orario era lento; l'ufficio ragiona per fasce (08:30, 11:30, 14:30, 16:30).

**Decisioni:**
- **Divider di fascia nella tabella** *Impianti da realizzare*: ogni fascia ha una riga-intestazione (`08:30`, `11:30`, `14:30`, `16:30`).
- **Fascia = quella più vicina** (`fasciaDi()`): un appuntamento 09:30 resta negli 08:30, uno alle 10:30 finisce in cima agli 11:30; a parità esatta di distanza (es. 10:00) vince la fascia più bassa. I confini cadono a 10:00, 13:00, 15:30; orari fuori giornata vanno alla prima o all'ultima fascia.
- **Trascinamento**: la maniglia ⠿ a destra della riga è `draggable` e trascina l'intera riga (non gli input, così scrivere nei campi resta comodo). Si rilascia su un divider o su una riga della fascia di destinazione: `applicaOrario()` porta l'orario all'inizio della fascia e, se serve, **registra la presa in carico** all'orario originale (con toast di conferma). Rilascio nella stessa fascia = nessun effetto.
- **Limite noto**: il drag usa gli eventi HTML5, quindi funziona col mouse (desktop); su touch si continua a scrivere l'orario nel campo. Il divider e la fascia non compaiono nelle sezioni Sospendere/Chiudere.
- **CORREZIONE 22/11**: il trascinamento era legato alla sola maniglia ⠿, quindi prendendo la riga non partiva nulla (nessun drag, nessun highlight). Ora è la **riga intera** a essere trascinabile (`abilitaDragRiga()`): il `mousedown` disattiva il drag quando il clic parte da un campo (`input/select/button/textarea`) così si continua a scrivere nei campi, e la maniglia resta solo come indizio visivo.
- **Drop delegato alla tabella** (`initDropFasce()`, una sola volta su `#tbodyRealizzare`): `dragover` illumina la riga/divider sotto il puntatore (`outline` tratteggiato viola, sfondo sul divider) e accetta il drop; `drop` legge la fascia da `data-fascia` della riga e chiama `applicaOrario`. Così si può rilasciare anche sullo spazio di una fascia, non solo sulla riga esatta.
- **Verifica automatica** con un harness in browser: funzioni reali estratte da `app.js` (`abilitaDragRiga`, `initDropFasce`, `applicaOrario`, `fasciaDi`) e `DragEvent` sintetici — 11/11 controlli (dragstart, dragover/preventDefault, highlight, spostamento di fascia, presa in carico automatica, nessun effetto nella stessa fascia, drop sul divider).

---

## 2026-11-23 — Distribuzione equa "lavorabile": due orari per fascia, lavorazioni brevi prima

**Motivazione:**
L'ufficio ha sistemato a mano la giornata di Asti del 24/11/2026 (11 pratiche, 2 tecnici:
Stefano e Riccardo) e il risultato era molto diverso da quello del `⚖️ Distribuisci equo`.
Il vecchio algoritmo spostava 5 impianti e riempiva orari che nessuno fa davvero (10:30),
perché lasciava gli impianti sfrattati perfino dagli 08:30 — dove i due tecnici erano già
occupati dai guasti — e poi li faceva slittare di un'ora alla volta fino alle 10:30.
Confrontando col foglio dell'ufficio sono emerse due regole non scritte: **due lavori per
tecnico nella stessa fascia** e **guasti/borchie/migrazioni trattati come interventi corti**,
che stanno nella stessa fascia dell'impianto normale senza togliergli il posto.

**Decisioni:**
- **Due orari di lavoro per fascia e per tecnico** (`postiDellaFascia()` in `js/distribuzione.js`): l'orario della fascia e quello un'ora dopo — 08:30/09:30, **11:30/12:30**, 14:30/15:30, 16:30/17:30. Le 12:30 sono un orario di lavoro come gli altri (indicazione dell'ufficio del 23/11). Così non escono più 10:30 e 13:30.
- **Le lavorazioni brevi vanno per prime e stanno insieme**: guasti, borchie e migrazioni sono interventi corti, quindi si sistemano prima degli impianti normali, **non rubano il posto** all'impianto della stessa fascia e **si raggruppano sullo stesso tecnico** (due interventi veloci nella stessa fascia), lasciando all'altro tecnico l'impianto normale da solo. Per ogni fascia e per ogni tecnico il piano accetta **un impianto normale e al massimo due interventi in tutto** (`maxImpiantiPerFascia` = 1, `maxVociPerFascia` = 2).
- **Due giri e si tiene il migliore**: il piano si calcola una volta raggruppando le brevi e una volta bilanciandole; vince quello che lascia **meno interventi senza posto** e, a parità, **meno telefonate ai clienti** (a parità assoluta vince il raggruppamento). Serve perché raggruppare a volte consuma il posto di un impianto: in quel caso si torna alla versione bilanciata.
- **I guasti entrano nel piano** (prima restavano fuori e bloccavano la fascia del loro tecnico): il tecnico è quello che li ha già in carico, la presa in carico resta all'orario originale e lo spostamento **non richiede telefonate**. I guasti presi in carico da un tecnico fuori dall'elenco degli impianti (i tecnici guasti dedicati del cluster) restano fuori dal piano: li gestisce il cluster, in numero illimitato.
- **Le borchie entrano nel piano come le migrazioni**: prima erano escluse dalla distribuzione; la borchia però va fatta da un tecnico e l'ufficio la considera una lavorazione breve da mettere per prima, quindi è passata nel gruppo `brevi` (impianti normali = solo `sezione === 'realizzare'`).
- **Un intervento resta al suo orario quando può**: la breve tiene l'orario della presa in carico anche se nella stessa ora il tecnico ha un'altra breve (nel foglio ufficiale ci sono due righe alle 14:30 per lo stesso tecnico); l'impianto tiene il suo orario. Se l'ora è già presa da un impianto, la breve usa l'altro orario della fascia (es. 12:30) e solo quando la fascia è piena passa alla fascia successiva.
- **Orari fuori standard conservati**: un intervento con presa in carico a un orario che non è uno dei due posti (es. 13:45) resta al suo orario, così ricalcolare il piano non inventa spostamenti.
- **Presa in carico e rientri invariati**: il piano parte sempre dall'`orarioOrigine`; chi era spostato e ritrova posto all'origine finisce nei **rientrati** (verde, nessuna telefonata). Gli **spostamenti** restano le telefonate da fare (impianti, borchie, migrazioni); i **guasti spostati** sono un elenco a parte (`guastiSpostati`), perché non richiedono conferma del cliente.
- **Il limite `Max interv./tecnico` continua a contare solo gli impianti normali**: brevi e guasti non lo consumano, come già deciso il 22/11.
- **Anteprima più leggibile** (`showDistribuzioneModal`): dice quanti impianti, brevi e guasti entrano nel piano, segna `(GUASTO)` e `(BREVE)` nelle righe, separa "📞 Da spostare — chiamare il cliente" da "🚨 Guasti spostati di un'ora (nessuna telefonata)".
- **`applicaDistribuzione`**: per i guasti aggiorna solo orario e presa in carico, senza riscrivere tecnico e `tecnicoCentraleExcel` (li decide il cluster).
- **API del modulo**: `pianificaDistribuzione({tecnici, interventi, brevi, guasti, maxPerTecnico, postiPerFascia, maxImpiantiPerFascia, maxVociPerFascia, fineGiornata})`; ritorna `piano` (con `guasto`/`breve` per riga), `spostamenti`, `guastiSpostati`, `rientrati`, `nonAssegnati` (elenco di **id**) e `carichi`. Test: `test_distribuzione.mjs` (33 controlli).

**Risultato sulla giornata del 24/11** (2 tecnici, 6 impianti, 2 migrazioni, 3 guasti):
Riccardo 6 interventi (3 impianti + 1 migrazione + 2 guasti), Stefano 5 (3 impianti + 1 migrazione
+ 1 guasto), **2 telefonate** (Matteotti e Dante 08:30 → 11:30) invece di 5 del vecchio
algoritmo e 3 del foglio a mano, **nessun guasto spostato**. Fasce: 08:30 impianto + guasto per
tecnico, 11:30 un impianto a testa, **14:30 le due lavorazioni veloci insieme a Riccardo
(guasto Petrarca + migrazione Cavallotti) e l'impianto da solo a Stefano (Alla Vittoria)**,
16:30 un intervento a testa (San Marco a Riccardo, migrazione Volta a Stefano). Confronto
visivo in `Distribuzione 24 11 2026 - confronto.xlsx` (fogli: ufficio a mano / vecchio / nuovo).

---

## 2026-11-23 — Memoria degli appuntamenti: PDF ricaricabili senza doppioni e lista condivisa

**Motivazione:**
Le attività escono dal portale nel corso della giornata, quindi lo stesso PDF viene ricaricato
più volte con qualche pagina in più. Prima ogni import accodava tutto e produceva doppioni; in
più la lista spariva a ogni refresh e non si ritrovava su un altro dispositivo, costringendo a
ridefinire tecnici, pallini (borchia/migrazione) e prese in carico già sistemati a mano.

**Decisioni:**
- **Identità stabile di un intervento** (`chiaveAppuntamento()` in `js/appuntamenti.js`): il codice **WR** (schede e Work Order lo hanno sempre), altrimenti appalto + indirizzo + cliente + orario in forma normalizzata; per le righe aggiunte a mano l'`id`. **Mai l'`id` degli interventi parsati**: viene rigenerato a ogni parsing e farebbe passare tutto per nuovo.
- **Import per unione** (`integraAppuntamenti()`): si aggiungono solo gli interventi non presenti; chi c'è già **resta com'è**, quindi tecnico, orario, presa in carico e "pallino" scelti a mano non vengono sovrascritti dal PDF. Il toast dice quanti nuovi e quanti già presenti.
- **`autoAssignGuasti(nuovi)`**: lavora solo sugli interventi appena importati e **salta i guasti che hanno già un tecnico**, così l'assegnazione fatta a mano non viene rifatta al ricaricamento né all'avvio.
- **Persistenza doppia**: `localStorage` (`tw_appuntamenti_v1`, immediato, così anche offline non si perde) + documento Firestore dedicato **`settings/assegnazioni_appuntamenti`** (campo `data`, JSON della lista) per ritrovare la lista su qualsiasi dispositivo. Scrittura con debounce di 800 ms e solo se il contenuto è davvero cambiato (firma JSON), per non consumare scritture Firestore.
- **Nessun conflitto con le impostazioni**: documento separato da `settings/assegnazioni_web` (che ha il suo `updateMask` e non tocca il nuovo campo).
- **All'avvio** (`caricaAppuntamenti()`): la copia **online vince** sulla locale; gli interventi presenti solo in locale (import fatto offline) vengono comunque aggiunti (`unisciCopieAppuntamenti()`).
- **Stato di partenza pulito**: `🗑️ Svuota Lista` svuota anche la copia online (il messaggio lo dice), così tutti i dispositivi ripartono vuoti lo stesso giorno.
- **Test**: `test_appuntamenti.mjs` (18 controlli: chiave WR/fallback, doppioni del reimport, pagine nuove, modifiche a mano mantenute, copia online vs locale). Scrittura del documento verificata via API (PATCH 200).
- **Nota**: `⚖️ Distribuisci equo` non tiene memoria di niente — rilegge la lista corrente a ogni click, quindi **cambiare il pallino e rilanciare basta**: il piano si ricalcola con la nuova classificazione (una borchia appena marcata diventa una lavorazione breve).

**Limite noto:** la sincronizzazione è all'avvio della pagina (niente polling). Se due dispositivi lavorano sullo stesso giorno contemporaneamente, vince l'ultimo salvataggio.

---

## 2026-11-23 — Export Excel identico al modello ufficiale, con le fasce libere visibili

**Motivazione:**
Il file generato non era riconoscibile come il modulo che l'ufficio usa davvero: intestazioni verdi, titolo in Arial, orari come testo, colonne strette. Inoltre le fasce senza appuntamenti sparivano dal foglio, quindi in stampa non si vedeva quali ore erano rimaste libere (e non c'era spazio per annotarle a mano).

**Decisioni:**
- **Stile copiato 1:1 da `Attività Technical Work Srl del.xlsx`** (il "vergine" dell'ufficio, copia identica in `Attività Technical Work Srl del (vergine).xlsx`):
  - font **Calibri 11, mai grassetto**; titolo e intestazioni **testo rosso `FF0000` su sfondo giallo `FFFF00`**, centrati; celle dati (orario, descrizione, tecnico) con **testo nero** sul fondo colorato;
  - larghezze colonne **A 5.92 / B 52.60 / C 24.62**; bordo sottile su tutte le celle; i dati iniziano dalla **riga 6** (righe 2, 4 e 5 vuote come nel modello);
  - orario scritto come **ora vera di Excel** (numero con formato `h:mm`), non come testo;
  - colonna descrizione **bianca** (nessun riempimento): **grigio `A5A5A5` solo per i guasti**, **giallo `FFFF00` solo per gli appuntamenti con presa in carico spostata di fascia** (`orarioOrigine` diverso dall'orario di lavoro), testo **rosso** per borchie e migrazioni; colonna tecnico con il **colore del tecnico**;
  - colori fascia presi dal modello: `08:30` rosso `FF0000`, `11:30` verde `00B050`, `14:30` arancione scuro `C55A11`, `16:30` blu `4472C4` (l'ora successiva della stessa fascia usa lo stesso colore, come nel modello dove 11:00 e 11:30 sono entrambe verdi);
  - sezioni **IMPIANTI DA SOSPENDERE** (3 posti per fascia) e **IMPIANTI DA CHIUDERE** (4 posti per fascia) con i titoli del modello (spazi iniziali compresi), righe vuote di separazione come nel "vergine".
- **Ogni fascia è stampata per ogni tecnico della giornata, senza righe finte**: si stampano le righe degli interventi che ci sono e, **per ogni tecnico che in quella fascia non ha niente, una riga "Altro appuntamento" con il suo nome nella colonna a destra** (e il colore del tecnico), così si vede subito chi è libero e ci si scrive sopra. I tecnici sono quelli che compaiono negli interventi da realizzare della giornata; chi ha già un intervento nella fascia non prende righe in più (resta la regola un intervento per tecnico per fascia, con gli extra solo quando servono, come il 24/11).
- **Uniche deviazioni volute (chieste dall'ufficio dopo la prova sul file vero)**: i testi delle colonne **orario, descrizione e tecnico sono neri** invece che bianchi (sul fondo colorato il bianco non si leggeva) e l'**altezza di riga è calcolata** dal testo, perché con la colonna da 52 caratteri gli indirizzi lunghi verrebbero tagliati in stampa (Excel non adatta l'altezza delle righe importate). Restano bianchi solo i titoli e i testi delle intestazioni, che sono rossi su giallo come nel modello.
- **La descrizione di borchie e migrazioni resta rossa** (regola del 22/11) sul fondo arancione.
- **File di confronto riscritto col generatore vero** (`aggiungiFoglio()` in `excelGenerator.js`): un workbook con tre fogli, tutti scritti da ExcelJS. La versione precedente era un collage fatto con openpyxl che perdeva `applyNumberFormat` sulle celle orario: in Excel si vedevano "#####" al posto delle ore.
- **Verifica automatica del 1:1**: `work/confronta_stili.py` confronta il file generato col "vergine" cella per cella (font, riempimenti, bordi, formati, larghezze) sulle righe strutturali e riporta zero differenze; `test_excel.mjs` (17 controlli) verifica struttura, orari come ore vere, colori, fasce libere e sezioni.
- **Il generatore è diviso in due**: `buildWorkbook()` (puro, funziona anche in Node, così si può testare e confrontare) e `exportToExcel()` (costruisce e scarica dal browser).

---

## 2026-11-23 — Descrizioni uniformi e tag BORCHIA/MIGRAZIONE anche sull'Excel

**Motivazione:**
Le descrizioni erano scritte a caso (indirizzo tutto maiuscolo, operatore minuscolo, apparati con maiuscole sparse, "ok" finale) e sul foglio non si capiva se un intervento fosse una borchia o una migrazione: lo si vedeva solo dal testo rosso, che è ambiguo.

**Decisioni:**
- **Nuovo modulo puro `js/formattatore.js`**, usato da `pdfParser.js` (import), da `app.js` (tabella) e da `excelGenerator.js` (foglio): un solo posto per la scrittura delle descrizioni.
- **Formato**: `Indirizzo (telefoni) · OPERATORE · APPARATI · TIPO`
  - indirizzo con le iniziali maiuscole e le particelle minuscole (`Corso alla Vittoria 36`, `Via dei Mille 12`), lettera del civico maiuscola (`21A`);
  - operatore in **maiuscolo** con i nomi noti (`WN`, `FW`, `ILIAD`, `ENI`, `TISCALI`, `VODAFONE`, `SKY`, `TIM`);
  - apparati in **maiuscolo** (`CPE3 + SFP`, `ONT 2.5 G`, `WI-FI 6 + SIM`);
  - **tag finale del tipo di lavoro**: `GUASTO`, `BORCHIA`, `MIGRAZIONE` (niente per le attivazioni normali) — così si legge subito di che lavoro si tratta, anche quando il testo non è rosso;
  - separatore ` · ` e **niente più "ok" finale**.
- **Tag e pallino sempre allineati**: la descrizione viene riformattata al momento di mostrarla/stamparla (`descrizioneIntervento()`), quindi cambiando il pallino il tag si aggiorna. Resta intatto il testo **scritto a mano**: il parser salva `descrizioneAuto` e se il testo salvato è diverso (l'utente l'ha modificato) si usa quello.
- **Guasti senza apparati** (regola storica confermata): per un guasto si stampa solo indirizzo, operatore e `GUASTO`.
- **Test**: `test_formattatore.mjs` (41 controlli: indirizzi, particelle, civico, operatori, apparati, tag, tipo impianto, testo manuale).

---

## 2026-11-24 — Impianto di terminazione (PTA / PTE) scritto nella descrizione

**Motivazione:**
Il tecnico deve sapere prima di partire che tipo di impianto trova e, per la PTE, se è in un punto diverso dal civico dell'appuntamento (es. Corso Volta 143 con PTE al 147): oggi l'informazione era nel PDF ma non arrivava mai sul foglio.

**Decisioni:**
- **PTA sempre dichiarata**: `PTA POZZETTO`, `PTA FACCIATA`, `PTA PALO` vengono scritte in fondo alla descrizione, prima del tag del lavoro.
- **PTE solo se è in un posto diverso**: si confrontano via e civico del punto di terminazione con quelli dell'appuntamento; se coincidono **non si scrive niente**.
  - stesso civico e stessa via → niente;
  - stessa via, civico diverso → **`PTE al 147`**;
  - via diversa → **`PTE in Via dei Mille 12`** (via estesa).
- **Da dove arriva il dato**: schede → campo `PTE / ROE TERMINAZIONE` (`A479_VIA GUIDO GINELLA_3_A_1 (Porta: 1)`, a volte con percorso davanti `AT_01/01e24/A479_...`); Work Order legacy → `INDIRIZZO_PTE - VIA PIETRO MICCA, 3`. Il parser salva `pteIndirizzo` e la funzione `indirizzoPte()` lo riduce a via + civico (gestisce accenti e civici alfanumerici tipo `70C`).
- **Posizione**: `Indirizzo (telefoni) · OPERATORE · APPARATI · IMPIANTO · TIPO` — es. `Corso Alessandro Volta 143 (3887828033) · ILIAD · CPE3 + SFP · PTE al 147`.
- **Tipo installazione `N/D`** (come nella maggior parte dei guasti): nessuna aggiunta, come prima.






