# todo.md — Assegnazioni Appuntamenti

## ✅ Completati
- [x] Inizializzazione progetto Vite, `package.json`, `vite.config.js`, `.bat` files (`avvia_progetto.bat`, `aggiorna_github.bat`).
- [x] Creazione del Parser PDF per i Work Order Open Fiber (`js/pdfParser.js`) con supporto Elecnor, Sertori, Sirti.
- [x] Estrazione avanzata PDF: raggruppamento per codice WR, parsing tipo intervento (Delivery/Assurance), orario, cliente, telefono `(numero)`, indirizzo, comune, centrale/POP/TOH, operatore OLO, apparati (con fix CPE3 senza sfp inventato).
- [x] Creazione del Generator Excel (`js/excelGenerator.js`) per esportare in formato `Attività Technical Work Srl del GG MM AAAA.xlsx`.
- [x] Formattazione testo orario Excel in nero in grassetto su sfondo colorato per massima leggibilità.
- [x] Creazione dell'Interfaccia Web (`index.html`, `css/style.css`, `js/app.js`) con area Drag & Drop PDF, tabelle suddivise per `Realizzare`, `Sospendere`, `Chiudere / Guasti`.
- [x] Integrazione selettore Custom Tecnici in `app.js` con box di ricerca integrato e z-index elevato (sovrapposizione corretta sopra altre righe).
- [x] Filtro dinamico dei tecnici attivi Android da Firestore (`settings/devices_names` & `settings/hidden_tecnici`), escludendo utenti Web, disattivati e bannati.
- [x] Integrazione tab "Casa" nella dashboard admin `tchwrk2` per impostare indirizzo e coordinate GPS dei tecnici Android.
- [x] Sistema di Ottimizzazione automatica delle rotte e carburante (`⚡ Ottimizza Assegnazioni`): geocodifica indirizzi via Nominatim OpenStreetMap, calcolo distanze Haversine e assegnazione greedy nearest-neighbor con bilanciamento carico e modale di riepilogo.
- [x] Selettore topbar presenze/ferie/malattie dei tecnici (`👥 Tecnici Attivi`) con checkbox dinamiche per escludere o includere i tecnici del giorno.
- [x] Selezionatore numerico `Max interv./tecnico` (default 4) nella topbar per capare il numero di appuntamenti assegnabili a ciascun tecnico nell'ottimizzazione.
- [x] Rilevamento automatico `AREA_CD - AB` e `AREA_CD - CD` dai PDF dei guasti ed **assegnazione automatica** immediata al tecnico preposto col ruolo `Guasti Cluster A/B` o `Guasti Cluster C/D` senza interventi manuali.
- [x] Mantenimento dei guasti nella sezione **🟢 IMPIANTI DA REALIZZARE** con evidenziazione visiva a sfondo grigio solido (`#2a3547` sul sito, `#C0C0C0` in Excel).
- [x] Posizionamento automatico dei guasti in **fondo alla rispettiva fascia oraria**, tutti compatti tra loro (es. a 08:30: prima le attivazioni/borchie, poi i guasti 08:30).
- [x] Flessibilità orario: lo spostamento manuale dell'orario ricolloca dinamicamente l'intervento nel blocco orario di destinazione.
- [x] Esclusione dei tecnici incaricati dei guasti dal calcolo dell'ottimizzazione automatica delle rotte degli impianti da realizzare, con assegnazione illimitata dei guasti estratti (fino a 20+ al giorno).
- [x] Rinominata sezione 3 sul sito in `🔴 3. IMPIANTI DA CHIUDERE` e ripristinate le fasce orarie vuote extra in Excel solo per le sezioni Sospendere (3 slot) e Chiudere (4 slot).
- [x] Opzione `🔵 Borchia` nel dropdown di riga: compare nella sezione Realizzare rispettando l'ordine cronologico delle fasce orarie, evidenziata con testo rosso sul sito e solo nella descrizione (colonna 2) in Excel.
- [x] Selettore dinamico dell'Azienda Appalto per riga nella tabella con gestore aziende nella topbar (**🏢 Aziende**) per aggiungere o rimuovere aziende personalizzate in tempo reale (salvate in `localStorage`).
- [x] Implementato Modal Custom per la Gestione Tecnici con selezioni presenze/ferie, ruoli specializzati e Color Picker custom con persistenza in `localStorage`.
- [x] Persistenza online delle impostazioni tecnici (colore, ruolo, presenza) su documento dedicato `settings/assegnazioni_web`, sincronizzata tra browser senza toccare `devices_names`.
- [x] Fix di stabilizzazione su parsing PDF e rimozione variabili non dichiarate.
- [x] Build di produzione (`npm run build`).
- [x] **Modalità Admin segreta**: 10 click rapidi sul badge `#logoBadge` attivano l'admin (classe `.logo-badge.admin`, gradiente rosso/arancio), sessione persistita in `localStorage` (`tw_admin_session`), nessun popup.
- [x] **Pannello Guasti admin-only** (`🚨 Guasti`, pulsante `#btnOpenGuastiConfig` visibile solo in admin): per ogni tecnico con ruolo guasti si configurano i **comuni** e gli **appalti** coperti via chip checkbox con salvataggio live.
- [x] **Comuni cluster-aware**: la scansione PDF legge `areaCd` (`AREA_CD - AB/CD`) di ogni guasto e abilita il comune **solo** sui tecnici del cluster giusto (AB → `guasti_ab`, CD → `guasti_cd`). Mappa `comuniClusters` persistita su Firestore.
- [x] **Appalti da GitHub config.json**: `loadCompaniesFromConfig()` scarica le aziende da `https://raw.githubusercontent.com/gmaclol/Technicalwork-Materiali/master/lists/config.json` con cache 24h (pattern tchwrk2), propagandole ai tecnici guasti.
- [x] **Migrazione pulizia comuni** (`migrateComuniData`): una tantum azzera lista comuni, mappa cluster e comuni/appalti dei tecnici guasti (pre-cluster), sincronizzando il vuoto su Firestore per una riscansione pulita senza doppioni.
- [x] Verifica su PDF reali (`context_study/`): il parser rileva correttamente AB (Torino/Asti/Biella) e CD (provincia) e assegna i comuni ai cluster giusti.
- [x] **Separazione `clusterCd` vs `areaCd`**: `clusterCd` estratto da TUTTI i work order (guasti: `AREA_CD`; attivazioni: `C_D - AB/CD` nei percorsi di rete) e usato da `collectComuni` (`p.clusterCd || p.areaCd`); `areaCd` valorizzato solo per i guasti. Fix del caso Viverone (cluster CD da PDF Delivery tipo 70) che non veniva abilitato di default.
- [x] **Selettore ruolo visibile a tutti**: il dropdown ruolo (`⚙️ Impianti / 🚨 Guasti AB / 🚨 Guasti CD`) nella Gestione Tecnici ora è mostrato a tutti gli utenti, non solo admin (rimosso gate `_isAdmin`).
- [x] **`disabledComuni` blacklist persistente**: i comuni disabilitati manualmente non vengono MAI riabilitati dagli scan PDF; Set in `localStorage` (`tw_disabled_comuni_v1`), sincronizzato su Firestore, saltato in `enableComuneForGuastiTechs`, svuotato dai handler "Svuota Comuni" e `migrateComuniData`.
- [x] **Nomi POP normalizzati**: `Pop1/Pop2/Pop3` maiuscoli in `formatTecnicoCentrale` (era `pop1/pop2/pop3`) in `pdfParser.js` e `getLocalita` in `app.js`.
- [x] **Colori tecnici in Excel**: sfondo colore del tecnico sulla cella colonna 3 (`getTechFill`, mappa `techColors` passata a `exportToExcel` via `buildTechColorsMap`), non applicato a righe guasto/borchia.
- [x] **Color picker palette Excel**: sostituito il picker nativo con paletta Excel classica a 56 colori (`EXCEL_PALETTE`, `openExcelColorPicker`, `.excel-color-popup` window-aware, z-index 100010).
- [x] **Fix fill Excel compatibile**: aggiunto `bgColor: { indexed: 64 }` a tutti i fill solidi (`solidFill`) perché senza alcune versioni di Excel mostrano la cella bianca; matching tecnico→colore robusto (primo membro squadra, nomi composti case-insensitive).
- [x] **PWA installabile**: `manifest.webmanifest`, Service Worker (`public/sw.js`, network-first per navigazione + cache stale-while-revalidate asset), icone PNG 192/512/maskable generate, registrazione SW in `app.js`, meta `theme-color`/`mobile-web-app-capable`/`apple-touch-icon`.
- [x] **Accessibilità**: skip link "Salta al contenuto", `role="dialog"`/`aria-modal`/`aria-labelledby` sulle modali, focus trap con Tab/Shift+Tab e ripristino focus, chiusura con Escape, `aria-hidden` gestito, `aria-label` su bottoni icona e input nascosti, `role="combobox"`/`listbox`/`option` nel selettore tecnici con `aria-expanded`, `scope="col"` e caption sulle tabelle, `aria-live="polite"` sulle statistiche, stili `:focus-visible` e `prefers-reduced-motion`.
- [x] **Responsive / PWA screen-fit**: `overflow-x: hidden` globale, topbar che va a capo sotto 1100px, layout compatto in `@media (display-mode: standalone)`, breakpoint 720px per telefono (tabelle con scroll orizzontale touch, modali full-width, etichette nascoste).

## 🔲 Backlog / Future Migliorie
- [ ] Salvataggio locale (localStorage/IndexedDB) dello stato degli appuntamenti della giornata.
- [ ] Integrazione OpenRouteService / OSRM API per matrice tempi/distanze su strada reale anziché Haversine.

