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

## 🔲 Backlog / Future Migliorie
- [ ] Salvataggio locale (localStorage/IndexedDB) dello stato degli appuntamenti della giornata.
- [ ] Supporto PWA offline con Service Worker per l'applicazione Assegnazioni Appuntamenti.
- [ ] Integrazione OpenRouteService / OSRM API per matrice tempi/distanze su strada reale anziché Haversine.

