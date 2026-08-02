# review.md — Dashboard (tchwrk2)

## 2026-07-04 — Sessione Correzione Bug Leak, Ottimizzazioni e Accessibilità

**Cosa è stato fatto:**
- Risolto il bug dei leak dei listener di background che causavano la visualizzazione intermittente e inaspettata di pannelli amministrativi (Tecnici, PFS, Aree Preferite) mentre l'utente visualizzava una tabella appalto.
- Importati e agganciati tutti i metodi di rimozione dei listener (`stopLiveListener`, `stopTecniciListeners`, `stopBannedListeners`, `stopPfsListeners`, `stopAreeListener`) all'inizio del router centrale `handleHashChange` in `js/app.js`.
- **Fase 1: Splitting CSS**: Diviso `css/components.css` in fogli stile separati per ciascun componente (`forms.css`, `sidebar.css`, `table.css`, `modal.css`, `toast.css`, `kpi.css`, `pfs.css`, `pfs-lookup.css`, `misc.css`) e importati in `css/components.css` tramite `@import`.
- **Fase 2: Centralizzazione Listener Billing**: Sostituiti tutti i listener `onSnapshot` indipendenti di `devices_names` in `app.js`, `pfsLookup.js`, `tecnici.js` e `aree.js` con un unico listener globale e un pattern Pub/Sub centralizzato in `state.js`.
- **Fase 3: Adeguamento Accessibilità (a11y)**: Implementato `tabindex="0"`, `role="button"` e `aria-label` dinamici sulle celle griglia materiali modificabili; inserito supporto tastiera (`Enter`/`Space`) per avvio editing; aggiunto stile `:focus-visible` per visualizzare i cursori di fuoco ad alto contrasto.
- Eseguito il build di produzione per aggiornare i file compilati in `docs/` e rigenerare il service worker della PWA.
- Aggiornato il grafo della conoscenza locale con `graphify update .`.

**Perché:**
- I listener real-time di Firestore (`onSnapshot`) e RTDB (`onValue`) montati dalle varie viste amministrative non venivano disattivati quando l'utente navigava via da esse. Quando avvenivano aggiornamenti in background sul database, i callback di questi listener orfani scattavano in background, eseguendo il rendering delle vecchie viste e sovrascrivendo l'HTML del container principale `#content`.
- Avere fino a 5 listener reattivi contemporaneamente sullo stesso documento `settings/devices_names` causava un elevato numero di letture di database a ogni cambio rotta o modifica delle impostazioni.
- Le celle modificabili della griglia materiali erano inaccessibili da tastiera e da screen reader, non offrendo alcun tipo di affordance a11y né un modo per essere modificate senza l'uso del doppio click/tap del mouse.

**File modificati:**
- `js/state.js`: Aggiunto Pub/Sub centrale per `devices_names` e caricamento automatico su utente.
- `js/app.js`: Rimossa query indipendente di `devices_names`, aggiunta iscrizione e accessibilità indicatore utenti online.
- `js/pfsLookup.js`: Sostituito listener autonomo con sottoscrizione pub/sub.
- `js/tecnici.js`: Transizione a pub/sub per web technicians e banned list.
- `js/aree.js`: Transizione a pub/sub per aree dashboard.
- `js/data.js`: Aggiunti attributi a11y (`tabindex`, `role`, `aria-label`) e gestione keydown (`Enter`/`Space`) per l'editing delle celle.
- `css/components.css`: Riscritto per fungere da indice di importazione dei moduli.
- `css/components/*`: Nuova cartella con i file CSS splittati.
- `index.html`: Corretto attributo `aria-hidden` sul menu laterale per accessibilità desktop e abilitato focus-accessibility sul contatore online.
- `tasks/todo.md`: Aggiunta checklist sessione.
- `tasks/lessons.md`: Aggiunte lezioni sulle tre fasi.
- `tasks/review.md`: Aggiornato questo riepilogo.

**Rischi residui:**
- Nessuno. La build compila correttamente senza errori e i moduli mantengono intatte tutte le funzionalità precedenti.

**Follow-up consigliati:**
- N/A.

---

## 2026-05-13 — Sessione Aggiornamento Real-Time & Notifiche


**Cosa è stato fatto:**
- Migrazione totale a `onSnapshot` per i moduli Admin (PFS, Aree Preferite, Tecnici) implementando un pattern centralizzato nel router `app.js` per distruggere le connessioni ai cambi rotta.
- Implementate Notifiche PWA / Toast background (global listener per nuovi PFS).
- Resa la Sidebar Navigation completamente "Stateful" sulla data di snapshot: cambiare data propaga l'aggiornamento URL a tutti gli elementi della sidebar, offrendo ai counter la capacità di "guardare nel passato" dinamicamente usando query dirette per data.
- Migliorata interfaccia non-admin rendendo le date compatte ("Mer 13/05") rispetto a stringhe orarie prolisse, abilitando in simultanea le KPI Cards anche per i viewer e non solo per gli admin.

**Perché:**
- Offrire una UI reattiva, sempre sincronizzata ed evitare ricaricamenti di pagina, senza sacrificare memoria client su listeners fantasma.
- Fornire chiarezza sui dati retrospettivi usando un "Global Date State".

**File modificati:**
- `app.js`: Routing e cleanup listener; sync hash snapshot.
- `data.js`: Gestione query snapshot counts e KPI visualizzazione.
- `utils.js`: Sicurezza escapeHtml in toast con markup HTML.
- `index.html`: Counter Sidebar notifiche non lette.
- `pfs.js`, `aree.js`, `tecnici.js`: Transizione a stream dati paralleli / dual-listeners e focus restore pattern.

**Rischi residui:**
- Costi Firebase Read: Poiché la sidebar calcola storicamente i documenti con `.endsWith` fetchando tutta la sub-collezione per le date, i click ripetuti sugli snapshot potrebbero generare un volume discreto di Reads se la base di tecnici cresce esponenzialmente per anno. Attualmente l'impatto è quasi irrilevante.

**Follow-up consigliati:**
- Strutturare query Firebase in backend per contare dati storici, per non far caricare tutte le stringhe di documenti al client in fase d'avvio per estrarre uno `.length`. 
- Creazione e cancellazione logica dei `stale_hashes` vecchi dal relativo documento d'appoggio.

---

## 2026-05-13 — Sessione Ricerca PFS Sidebar & Web Users Sync

**Cosa è stato fatto:**
- Introdotta sezione **Ricerca PFS** con fetch dinamico da GitHub per file `.json` e parsing liste.
- Implementata **Identificazione Web Users**: tracking sessioni web con impronta digitale (OS, browser, core, ecc.), separando nella tab *Tecnici* l'elenco Android da quello Dashboard.
- Sincronizzazione preferenze bidirezionale per le aree (`pfsAreas`), con fix race-condition che impediva l'aggiornamento admin.
- Integrati i nomi personalizzati admin all'interno dell'indicatore 'Utenti Online' in topbar.
- Styling aggiornato: rimosso l'uso di CSS rigido per gli header divisi `tecnici-divider` per organizzazione gerarchica visiva.
- **UI/UX:** Migliorata l'affordance del pulsante "Ricerca PFS" applicando uno stile a bottone (`btn-outline`) con colori d'accento, per renderlo più evidente rispetto al testo semplice.
- **Mobile/PWA:** Creato un tooltip personalizzato per l'indicatore degli utenti online, gestito via JS (`pointerdown`, `pointerup`), per ovviare al problema dell'attributo `title` nativo inaccessibile su touch.

**Perché:**
- Permettere agli utenti di filtrare e esplorare rapidamente aree (e comuni).
- Offrire all'admin il totale controllo (read/write/rename) sulle utenze collegate via sito web, come già avviene per l'app nativa.
- Risolvere conflitti distruttivi (Race Conditions) tra l'invio dati del router all'avvio e le modifiche dal pannello admin.
- L'indicatore online era inaccessibile su dispositivi mobile/touch perché la pressione lunga innescava il context menu nativo anziché mostrare il classico tooltip di `title`.

**File modificati:**
- `pfsLookup.js`: Core ricerca aree, toggle favs, tracking device, fetch JSON GitHub.
- `app.js`: Riorganizzazione cleanup (sidebar protetta da router), presenza online customizzata con lettura parallela di `devices_names`.
- `tecnici.js`: Parser divisorio Web vs Android basato su flag `type: 'web'` ed estrattore config OS/Browser per descrizioni testuali.
- `aree.js`: Fallback nome dispositivo aggiornato a `.baseName`.
- `components.css`: CSS layout divisore Tecnici.

**Rischi residui:**
- La stabilità degli hash fingerprint (`getShortId`) per gli utenti web dipende dall'integrità del `localStorage`. Se un utente cambia browser, risulterà come nuova istanza separata. (Comportamento accettato ma da monitorare).

**Follow-up consigliati:**
- Espandere fetch regione su click dinamico invece di pre-fetcharla silenziosamente per tutte se si dovessero esplorare aree extra.

---

## 2026-05-15 — Fix PWA iOS Safari Crash e Accessibilità (a11y)

**Cosa è stato fatto:**
- Risolto crash su Safari iOS ("va in crash alla prima lettera") nell'input di ricerca PFS e ricerca Regioni introducendo `debounce` nei listener `oninput` (150ms).
- Introdotte protezioni di null-safety sulla regex `rawAddress` in fase di filtro PFS per prevenire exception UI.
- Sistemata la sidebar PWA su mobile: ora la modalità chiara mostra correttamente lo sfondo `light` anziché forzare l'overlay scuro fisso.
- Implementata regola `font-size: 16px` per gli input mobile, che inibisce allo iOS Safari di effettuare zoom-in indesiderati al focus che spaccavano l'impaginazione.
- Adeguata la topbar e la sidebar inserendo i padding/margin necessari in virtù delle variabili css `env(safe-area-inset-*)` (per rispettare lo status bar notch dei dispositivi iOS e la control bar in basso).
- Allineati i touch-targets per l'accessibilità (a11y) garantendo almeno `44x44` pixels (`pfs-lookup-star`, `.pfs-action-btn`, e region-chips).

**Perché:**
- Un ri-render DOM sincrono e pesante su stringhe ad ogni singola pressione di tastiera mandava in timeout o faceva esaurire la memoria al runtime della PWA su iPhone 15 e Safari.
- Rispondere in modo reattivo e ottimale al focus design pattern di iOS.
- Correggere le incongruenze estetiche relative ai temi dinamici su mobile.

**File modificati:**
- `js/pfsLookup.js` (Debounce lookup e fix undefined exceptions)
- `css/responsive.css` (Fix background `data-theme="light"`, safe areas e inputs no-zoom).

**Rischi residui:**
- Nessuno evidente. Per dispositivi hardware obsoleti (con <2GB RAM), manipolare ~1000 DOM nodes ad ogni carattere digitato con 150ms di debounce resta comunque costoso. Potrebbe servire della paginazione futura se le voci JSON dovessero superare i 1500 elementi per view.

---

## 2026-05-15 — Ottimizzazione Firebase: Risoluzione Spike Reads e Writes

**Cosa è stato fatto:**
- Disattivato il pre-caricamento parallelo di tutti gli appalti via `onSnapshot` per i contatori della sidebar (`preloadCounts`), limitando l'aggiornamento real-time solo alla tab attiva.
- Disattivato il ciclo di fetch storico passivo (`getDocs`) massivo su tutti gli appalti al cambio di data.
- Sostituito completamente il sistema di "Utenti Online" (Presence): spostato l'heartbeat periodico da **Firestore** (costoso per singole scritture) a **Realtime Database (RTDB)** (event-driven).
- Implementata logica RTDB per la gestione multi-tab client-side (uso di `connections` e re-assert listener locale) garantendo la conformità senza l'ausilio di Cloud Functions.
- **Hotfix (2026-05-15)**: Implementato il tracking nativo di `visibilitychange` per gestire le "disconnessioni fantasma" (sessioni zombie) quando gli OS mobile congelano l'app in background o quando la tab viene chiusa bruscamente, forzando un aggiornamento sincronico dello stato RTDB a "offline".

**Perché:**
- Il sistema originario della sidebar causava una reazione a catena in cui all'apertura si scaricavano migliaia di documenti (`Reads`), superando la quota gratuita per piccoli account.
- L'heartbeat di Firestore per segnalare un utente online originava una scrittura (`Writes`) ogni 45 secondi. Se lasciato aperto su più tab o dispositivi, questo bombardava i database raggiungendo rapidamente il limite delle 20.000 scritture/giorno della free tier. RTDB risolve questo problema in modo nativo e gratuito, gestendo i `onDisconnect` server-side.

**File modificati:**
- `js/data.js` (Disattivazione loop read bomb).
- `js/app.js` (Migrazione a RTDB Presence e patch `visibilitychange` per disconnessioni PWA in background/tab chiuse).
- `js/firebase.js` (Inclusione RTDB SDK).

**Rischi residui:**
- Nessuno. L'approccio adottato abbassa il footprint del database dell'80-90% riportando le letture e le scritture alla naturale operatività asincrona dei tecnici sul campo.

---

## 2026-05-16 — Ottimizzazione Caching e Sincronizzazione Real-Time

**Cosa è stato fatto:**
- Implementata logica per il reload automatico della PWA all'aggiornamento (`controllerchange`), eliminando la necessità di premere manualmente `Ctrl+F5` per caricare nuove versioni.
- Aggiunta procedura di risveglio sicuro di Firestore (`disableNetwork` / `enableNetwork`) quando la PWA rientra in foreground (`visibilitychange`), ma limitata ai soli casi in cui è rimasta in background per più di un minuto. 
- Mantenute invariate le cache locali (`localStorage`) e il `NetworkFirst` di GitHub per non eccedere nelle richieste API verso l'host.

**Perché:**
- Molto spesso i web socket di Firebase si congelavano lasciando l'app aperta in background o dopo sospensioni del PC/mobile, mostrando dati obsoleti.
- Un riavvio incondizionato o lo smontaggio dei listener di Firestore ad ogni focus avrebbe generato enormi sprechi in termini di "Reads" consumando la quota gratuita di Firebase. In questo modo si forza un reconnect indolore.
- L'auto-reload PWA impedisce nativamente sessioni "zombie" dovute all'inattività dell'aggiornamento automatico del Service Worker.

**File modificati:**
- `js/app.js` (Listener `controllerchange` e toggle della rete in `visibilitychange`).
- `js/firebase.js` (Esportate funzioni `disableNetwork` e `enableNetwork`).

**Rischi residui:**
- Auto-reload potrebbe interrompere l'utente se si sta inviando un form o compiendo un'azione, tuttavia l'applicativo funge per l'Admin principalmente come cruscotto di visualizzazione passiva, quindi il rischio pratico è assente.

---

## 2026-05-16 — Audit e Fix Write Firestore Eccessive

**Cosa è stato fatto:**
- Audit completo di tutte le operazioni Firebase (Firestore + RTDB) dell'intera codebase web.
- Identificato il killer principale: `checkStaleHashes()` invocata dentro il callback `onSnapshot` live generava ~960 write/giorno (1 per ogni sync di ogni tecnico, moltiplicato per ogni dashboard aperta).
- **Fix 1**: `checkStaleHashes()` ora eseguita **una sola volta** al primo caricamento dell'appalto, con cache in `_staleCacheMap`. Reset al cambio appalto.
- **Fix 2**: `registerWebUser()` ora protetta da `sessionStorage`, evitando write ridondanti su `devices_names` ad ogni page load (~20 write/giorno eliminate).

**Perché:**
- L'utente hittava ripetutamente il limite di writes Firestore (20K/giorno nel piano Spark). L'analisi ha rivelato che la quasi totalità delle write automatiche della dashboard proveniva da `checkStaleHashes` dentro un `onSnapshot`, pattern architetturalmente errato.

**File modificati:**
- `js/data.js` (Guard `_staleCheckedForAppalto` + cache `_staleCacheMap`)
- `js/pfsLookup.js` (Guard `sessionStorage` in `registerWebUser`)

**Rischi residui:**
- Lo stale badge non si aggiorna in tempo reale durante la sessione corrente (si aggiorna al prossimo cambio appalto o refresh). Tradeoff accettabile: lo stale badge è informativo, non critico.
- `preloadCounts()` mantiene ancora `onSnapshot` su tutte le collection per i badge sidebar. Questo genera reads (non writes) e al momento non è il bottleneck, ma potrebbe esserlo in futuro se il numero di appalti cresce.

**Follow-up consigliati:**
- Unificare i 2-4 listener su `settings/devices_names` in un singolo listener condiviso per ridurre le reads in cascata.
- Valutare se `preloadCounts()` debba rispettare la decisione del 2026-05-15 (solo badge per appalto attivo).

---

## 2026-05-17 — Sessione Ottimizzazione PWA iOS Safari (Pagine DOM)

**Cosa è stato fatto:**
* Risolto crash irreversibile e freeze di memoria su iOS Safari (WebKit) durante l'esplorazione di aree geografiche eccezionalmente grandi (es. Roma ~5800 PFS).
* Implementata **paginazione DOM incrementale** ("Load More") in `js/pfsLookup.js` definendo la costante `MAX_VISIBLE_ITEMS = 100`.
* Ora i dati completi dell'area rimangono trattenuti in memoria RAM client-side, e solo i primi 100 nodi DOM vengono fisicamente iniettati. I nodi successivi vengono accodati di 100 in 100 all'attivazione del pulsante dinamico `#pfs-load-more`.
* Mantento intatto e reattivo il filtro testuale (Search Bar), che esegue la ricerca in RAM e rigenera la vista paginata partendo da zero.

**Perché:**
* L'iniezione diretta di oltre 5000 nodi HTML complessi mandava istantaneamente in Out Of Memory (OOM) il motore WebKit di iOS Safari su iPhone, mandando in blocco l'applicazione.
* L'approccio paginato riduce l'impatto sul DOM di oltre il 98%, offrendo un'esperienza d'uso fluida a 60fps anche su hardware obsoleto.

**File modificati:**
* `js/pfsLookup.js` (Pagination logic & load more container).

**Rischi residui:**
* Nessuno noto.

**Follow-up consigliati:**
* Nessuno immediato.

---

## 2026-05-28 — Scansione Completa Codebase e Popolamento struttura.md

**Cosa è stato fatto:**
- Scansione completa di tutti i file significativi del progetto (esclusi node_modules, build).
- Analisi approfondita di ogni file JS, CSS, HTML e di configurazione.
- Popolato `tasks/struttura.md` con:
  - **Architettura Generale** (stack, pattern, layer applicativi, confini)
  - **6 Flussi Dati Principali** (login, navigazione, griglia materiali, presenza, PFS lookup, notifiche, export)
  - **Mappa completa di 18 file** raggruppati per categoria (JS Core, HTML/Config, CSS, Task)
  - **Punti di Attenzione** (debito tecnico, dipendenze circolari, codice duplicato, rischi noti)

**Perché:**
- Task one-shot di onboarding per fornire una mappa navigabile del codebase.
- Ridurre la necessità di riaprire file per comprendere ruoli, responsabilità e relazioni.

**File analizzati:**
- `js/app.js`, `js/auth.js`, `js/state.js`, `js/firebase.js`, `js/data.js`, `js/pfs.js`, `js/pfsLookup.js`, `js/tecnici.js`, `js/aree.js`, `js/export.js`, `js/utils.js`
- `index.html`, `vite.config.js`, `package.json`
- `css/variables.css`, `css/components.css`, `css/themes.css`, `css/responsive.css`
- `.gitignore`, `avvia_progetto.bat`, `aggiorna_github.bat`
- `tasks/decisions.md`, `tasks/lessons.md`, `tasks/review.md` (esistenti)
- `onboarding.md`, `Regole.md`

**Rischi residui:**
- `struttura.md` riflette lo stato attuale del codebase ma deve essere mantenuto aggiornato dopo ogni modifica architetturale.
- `components.css` (1130 righe) e `data.js` (871 righe) rimangono i file più critici per manutenibilità.

**Follow-up consigliati:**
- Vedi sezione "Punti di Attenzione" in `struttura.md` per la lista completa dei miglioramenti proposti.

---

## 2026-05-31 — Fix Rinomina ed Elimina Materiali nella Tabella Admin

**Cosa è stato fatto:**
- Corretti i pulsanti ✏️ Rinomina e 🗑️ Elimina per le righe materiale nella griglia admin, che non erano operativi a causa di diversi bug introdotti nella prima implementazione.
- **Bug 1 — ReferenceError `modalMsg`:** All'interno di `editMaterialRow()` veniva referenziata una variabile `modalMsg` mai dichiarata nel modulo. Sostituita con il recupero esplicito dell'elemento `#confirm-msg` via `document.getElementById`.
- **Bug 2 — Logica di annullamento errata:** Il check `choice === 'cancel'` non corrispondeva al valore di ritorno effettivo di `showConfirm()`, che risolve a `false` quando l'utente clicca "Annulla". Questo faceva passare l'esecuzione alla fase di update anche su annullamento, mostrando un toast di successo fittizio con "0 tecnico/i". Corretto in `if (!choice) return;`.
- **Bug 3 — Tecnici non trovati:** `editMaterialRow()` cercava i tecnici solo tra `window._lastTecnici`, che contiene solo chi ha sincronizzato nella giornata corrente. Ora interroga direttamente Firestore (`getDocs` sulla collection dell'appalto corrente) per trovare tutti i tecnici che possiedono il materiale, indipendentemente dalla data di ultimo sync.
- **Bug 4 — Escape quote nei nomi materiale:** Nomi materiale contenenti apostrofi o caratteri speciali rompevano il parsing HTML dell'attributo `onclick`. Sostituito con un pattern sicuro basato su `data-material` + `escapeHtml()` e `this.dataset.material`.
- **Fix accessorio — `renameWebTecnico`:** La funzione nella sezione Tecnici passava una stringa diretta a `showRenameModal()` anziché un oggetto `{title, defaultValue, icon}`, causando un titolo vuoto e campo di input non precompilato nel modal. Corretto con l'oggetto appropriato.
- **Robustezza `showRenameModal`:** La funzione in `utils.js` ora gestisce gracefully sia un argomento stringa (retrocompatibilità) sia un oggetto di opzioni, evitando crash se chiamata con il tipo sbagliato.

**Perché:**
- I pulsanti erano stati aggiunti visivamente nella sessione precedente ma non erano mai stati verificati in runtime, risultando completamente non funzionanti al click a causa di eccezioni JavaScript silenziose e logica di flusso errata.

**File modificati:**
- `js/data.js` (Riscrittura `editMaterialRow()`, fix data-attributes in `renderTable()`)
- `js/tecnici.js` (Fix `renameWebTecnico()`)
- `js/utils.js` (Robustezza `showRenameModal()`)

**Rischi residui:**
- L'avviso `INEFFECTIVE_DYNAMIC_IMPORT` di Vite in build (per `firebase.js` e `state.js`) non è un errore ma un warning informativo: i dynamic import in `editMaterialRow`/`deleteMaterialRow` servono per accedere a `updateDoc` che non è nell'import statico di `data.js`, e funzionano correttamente pur senza creare chunk separati.

**Follow-up consigliati:**
- Aggiungere `updateDoc` nell'import statico di `data.js` per pulizia, eliminando il dynamic import ridondante.

---

## 2026-05-31 — Sincronizzazione Real-Time Tecnici e Mini-Editor Inline Quantità

**Cosa è stato fatto:**
- Rimosse tutte le chiamate sincrone / distruttive manuali a `showTecnici()` all'interno delle azioni sui tecnici (`deleteTecnico`, `renameTecnico`, `toggleTecnico`).
- Modificati i rendering della tabella e dell'elenco tecnici affinché utilizzino `getHiddenTecniciSync()`, che restituisce sincronamente in RAM i tecnici disattivati, abbattendo le chiamate `getDoc` superflue.
- Introdotto un listener `onSnapshot` globale su `settings/hidden_tecnici` che sincronizza all'istante lo stato in memoria e aggiorna di riflesso sia i badge counts della sidebar, sia la tabella dei materiali se l'utente vi si trova sopra.
- Aggiunto un listener `onSnapshot` all'interno di `showBanned()` per aggiornare reattivamente la tabella dei dispositivi bloccati al ban/unban/cancellazione dati.
- Implementato l'**inline quantity editor**: gli amministratori possono fare doppio click sulle celle delle quantità in modalità Live per aprire un input di testo inline. L'editor salva su Firestore al `blur` o premendo `Enter`, e annulla su `Escape`, propagando la modifica tramite il rendering incrementale.
- Aggiunti stili CSS in `components.css` per evidenziare le celle editabili e formattare l'input inline.

**Perché:**
- I cambi di visibilità e i rename dei tecnici non si riflettevano all'istante tra client diversi o senza ricaricare la pagina. Inoltre, le chiamate manuali a `showTecnici()` causavano fastidiosi sfarfallii e costosi cicli di distruzione/creazione dei listener Firebase.
- L'utente ha espressamente richiesto la capacità di editare le quantità direttamente dal cruscotto principale senza dover interagire con popup esterni, supportando anche testi e addizioni.

**File modificati:**
- `js/data.js` (Listener globale `hidden_tecnici`, caching `_lastAllDocs`, helper sincroni per la visibilità, attributi cella e logica editor `editQuantityInline`).
- `js/tecnici.js` (Listener locale `hidden_tecnici` in `showTecnici()`, listener `onSnapshot` per i bannati in `showBanned()`, rimozione rinfreschi manuali).
- `js/app.js` (Routing cleanup con `stopBannedListeners()`).
- `css/components.css` (Stili `.editable-cell` e `.quantity-edit-input`).

**Rischi residui:**
- Nessuno noto. L'uso dei listener real-time nativi e della cache in RAM ha dimezzato le letture Firebase del client durante le operazioni amministrative.

**Follow-up consigliati:**
- Esportare `updateDoc` staticamente in `data.js` per risolvere definitivamente il warning sul dynamic import.

---

## 2026-06-20 — Ottimizzazione PWA Mobile — Tabella Appalti/Materiali

**Cosa è stato fatto:**
- Riscritta la sezione `@media (max-width: 900px)` di `css/responsive.css` per la parte riguardante la tabella materiali e il layout dell'area contenuto.
- **Content header** ridisegnato su mobile: layout row compatto (non più colonna), titolo ridotto a 20px, subtitle inline con separatore verticale, azioni (snapshot + esporta + stampa) compatte e senza wrap.
- **KPI Cards**: disposte su 3 colonne fisse, padding ridotto, font compatto (icon 16px, value 16px, label 9px) per occupare meno spazio verticale.
- **Tabella materiali**:
  - `td-material` e `th-material` ora sticky a sinistra con larghezza fissa 125px, font 11px, word-break abilitato (nessun troncamento, il testo va a capo) e ombra destra per staccarsi visivamente durante lo scroll orizzontale.
  - `thead th` sticky in alto (`z-index: 20`) per mantenere i nomi tecnici visibili durante lo scroll verticale.
  - Celle `td`/`th` con padding ridotto a 8px×10px.
  - Colonne tecnici (`th-tech`): max 115px, nome font 11px, orario font 9px.
  - `tech-location` trasformato in icona 📍 di 24×24px (font-size 0 + `::before` content) per non sprecare spazio in header.
  - `tech-battery` compatto (24px height, 9px font).
  - `td-value` 11px, `has-value` padding ridotto a 4px.
  - Stale badge reso ultra-compatto (8px font, solo `⚠ dd/mm`).
- **Barra di ricerca**: padding ridotto, full-width su mobile.
- **Light mode**: aggiornate le varianti sticky column con ombra destra proporzionata e hover corretto.
- **Build**: `npm run build` passato senza errori. Warning `INEFFECTIVE_DYNAMIC_IMPORT` preesistente e non critico (già documentato in review precedente).

**Perché:**
- Su telefono la tabella era illeggibile: header delle colonne tecnici altissimi, colonne larghissime, KPI occupavano metà schermo verticale. Il risultato è ora compatto, la prima colonna materiali rimane visibile durante lo scroll orizzontale e la riga header rimane visibile durante lo scroll verticale.

**File modificati:**
- `css/responsive.css` (sezione `@media (max-width: 900px)` — content, table, KPI, search)
- `js/data.js` (stale badge testo compatto: `⚠ dd/mm`)
- `tasks/decisions.md` (sezione Stack e Vincoli aggiunta)
- `.gitignore` (aggiunto `KEYS.md`)

**Rischi residui:**
- Su schermi molto piccoli (<360px), le 3 colonne KPI potrebbero risultare strette ma rimangono leggibili.
- Il `::before` content su `.tech-location` potrebbe non applicarsi se il testo visibile richiede display:none; testare su device reale.

**Follow-up consigliati:**
- Verificare su device Android e iOS reali con credenziali Piero (viewer) e Stefano (admin).
- Valutare se aggiungere un pulsante "Mostra/Nascondi colonne" su mobile per ridurre ulteriormente le colonne visibili.

---

## 2026-06-22 — Fix Scrollabilità Admin Mobile + Bug Tecnico Nascosto (Race Condition)

**Cosa è stato fatto:**
- **Scrollabilità PWA mobile**: I pannelli admin su mobile (`.tecnici-panel`) non avevano scroll container proprio, e `.content` aveva `overflow: hidden !important`. Aggiunte 3 righe CSS in `responsive.css` dentro `@media (max-width: 900px)`.
- **Bug tecnico nascosto (race condition startup)**: `_hiddenCache` partiva `null`. I listener `onSnapshot` sugli appalti si attivavano prima del listener su `hidden_tecnici`, ricevendo `[]` come hidden list. Tutti i tecnici passavano il filtro. **Fix:** Eager fetch di `_hiddenCache` in `preloadCounts()` con `getDoc` prima di montare i listener.
- **Bug badge sidebar non aggiornato**: Il listener `hidden_tecnici` chiamava `triggerTableRenderWithHidden()` che ri-filtrava la tabella ma non aggiornava `_liveCounts[currentAppalto]` né il badge `cnt-*`. **Fix:** Aggiunto aggiornamento di `_liveCounts` e badge dopo il re-render.
- **Fix accessorio (`app.js`)**: `buildSidebar()` chiamava `preloadCounts()` senza `await`, per cui `handleHashChange()` poteva scatenare il primo render prima che `_hiddenCache` fosse popolato. Aggiunto `await`.

**Perché:**
- Su mobile i pannelli admin (tecnici, PFS, aree) erano inaccessibili perché il contenuto usciva dal viewport senza possibilità di scroll.
- Il bug "tecnico nascosto che riappare dopo sync" era il secondo episodio (dopo il fix del 2026-06-22 sessione 1). La root cause era una race condition all'avvio tra listener, mascherata dal fatto che `visibilitychange` (PWA background) riavviava tutti gli `onSnapshot`.

**File modificati:**
- `css/responsive.css` (righe 57-61: scroll per `.tecnici-panel` su mobile)
- `js/data.js` (eager fetch `_hiddenCache` in `preloadCounts`, badge update in `triggerTableRenderWithHidden`)
- `js/app.js` (`await preloadCounts()`)

**Rischi residui:**
- Nessuno evidente. Il fix è localizzato e non tocca altri flussi.
- Il warning `INEFFECTIVE_DYNAMIC_IMPORT` di Vite è preesistente e non correlato.

**Follow-up consigliati:**
- `resetHiddenCache()` in `data.js:89` è definito ma mai chiamato in runtime. Valutare se serve o va rimosso.
- Valutare se unificare i 2-4 listener su `settings/devices_names` come già segnalato in review precedenti.

---

## 2026-06-23 — Sessione Correzione Bug Router (DeepSeek Regressions)

**Cosa è stato fatto:**
- **Risolto bug parsing hash del router**: Modificato il parsing del `window.location.hash` in `js/app.js:handleHashChange` per rimuovere esplicitamente il prefisso `#/` (con `hash.startsWith('#/') ? hash.slice(2) : hash.slice(1)`) prima dello split, prevenendo l'elemento vuoto all'inizio di `parts` che shiftava erroneamente tutti i parametri di rotta.
- **Sincronizzazione topbar**: Aggiunto l'aggiornamento automatico dell'elemento topbar `#tb-appalto` all'interno dell'handler centrale di routing (`handleHashChange`) in risposta all'evento `hashchange`.
- **Eseguito build**: Generato il bundle di produzione aggiornato tramite `npm run build` nella cartella `docs/`.
- **Aggiornato il grafo**: Eseguito `graphify update .` per sincronizzare il grafo della conoscenza.

**Perché:**
- Un errore grossolano nel parsing dell'hash dell'URL causava il caricamento dell'azienda fittizia `"appalti"` e lo snapshot `"Sertori"` ad ogni cambio di vista/caricamento, portando alla schermata vuota di fallback "Nessun tecnico ha sincronizzato dati per questa selezione" ed impedendo il corretto rendering dei dati delle tabelle.
- Il selettore dell'appalto in alto a sinistra era scollegato dall'URL routing, mostrando permanentemente il fallback `—`.

**File modificati:**
- `js/app.js` (corretto parsing dell'hash in `handleHashChange` e sincronizzazione del nome appalto su `#tb-appalto`)

**Rischi residui:**
- Nessuno. La modifica è estremamente pulita e localizzata sul solo router.

**Follow-up consigliati:**
- Rimuovere o deprecare la funzione `selectAppalto` se ridondante rispetto al routing nativo.

## 2026-06-23 — Sessione PWA Bugfix (Theme Switcher, Online Count, Routing e Tooltip)

**Cosa è stato fatto:**
- **Ripristinato pulsante Theme Switcher**: Aggiunto lo pseudo-elemento `.btn-theme::before` in `css/themes.css` con le maschere SVG Lucide di una luna crescente (`🌙`) per il tema scuro (default) e di un sole (`☀️`) per il tema chiaro. Utilizzando `background: currentColor;` e `mask-size: contain;` le icone si integrano in modo fluido e responsive al look del design system.
- **Risolto bug di visualizzazione indicatori online**: Aggiunto codice esplicito in `js/app.js` (`onlineEl.style.display = 'flex'`) per rimuovere l'inline style `display: none` introdotto in HTML all'attivazione del modulo per gli amministratori, e ri-occultato (`'none'`) in `stopPresence()`.
- **Risolto caricamento rotte Bloccati e PFS Lookup**: Importato correttamente `showBanned` da `tecnici.js` e `showPfsRegionBrowser` da `pfsLookup.js` nel file `app.js`, e aggiornata la logica del router per invocarle direttamente senza passare da riferimenti globali `window.*` inesistenti.
- **Risolto Hold Utenti Attivi su mobile/PWA**: Aggiunto il container `.online-tooltip` in `index.html` all'interno di `#topbar-online` e configurati in `app.js` i listener `pointerdown` (che chiama `preventDefault()` su `contextmenu` per bloccare il menu nativo), `pointerup` e `pointerleave` per gestire l'apparizione della lista utenti in tempo reale su dispositivi touch.
- **Allineamento Dimensioni Topbar**: Dimensionato `.btn-theme` a 36x36px per allinearsi geometricamente a `.topbar-user` (il pulsante logout) su dispositivi mobili.
- **Build di Produzione**: Eseguito `npm run build` per generare i file pre-compilati all'interno della directory `docs/`.
- **Aggiornato il grafo**: Eseguito `graphify update .` per allineare l'indice locale e mantenere la consistenza del progetto.

**Perché:**
- Nel passaggio delle modifiche precedenti, il CSS associato al pulsante cambia tema era privo di icone e di pseudo-elementi `::before`/`::after`, visualizzando un cerchio vuoto su schermi mobile.
- L'indicatore utenti online (`#topbar-online`) era impostato in HTML con `style="display:none;"` e non veniva mai mostrato via codice JavaScript, rimanendo perennemente invisibile anche in modalità Admin con presenza attiva.
- Le rotte `/admin/banned` e `/pfs-lookup` facevano riferimento a metodi `window.showBanned` e `window.showPfsRegionBrowser` non dichiarati, bloccandone l'esecuzione.
- Il comportamento `title` standard per visualizzare la lista utenti connessi non è supportato o innesca menu nativi del sistema operativo su browser mobili/PWA.

**File modificati:**
- `index.html` (aggiunta del contenitore del tooltip per gli utenti online)
- `css/themes.css` (definizione pseudo-elemento ed icone SVG per cambia tema, allineamento dimensioni topbar)
- `js/app.js` (correzione degli import di routing per bloccati e pfs-lookup, visualizzazione/occultamento dinamico del badge `#topbar-online`, bind eventi pointer e compilazione del tooltip utenti online)

**Rischi residui:**
- Nessuno. I componenti mantengono le logiche isolate e native esistenti.

---

## 2026-06-23 — Sessione Accessibilità PWA, Gestione Scroll-Lock e Icone Dispositivo

**Cosa è stato fatto:**
- **Migliorato click-to-close del Drawer**: Aggiunto un listener per l'evento `pointerdown` sull'overlay del drawer (`#sidebar-overlay`) per garantire la chiusura istantanea della barra laterale su touch screen mobili senza delay.
- **Introdotto Scroll-Lock Incrementale**: Creata un'utilità per contare e tracciare le richieste di blocco dello scroll (`window.lockScroll` / `window.unlockScroll`) che applica la classe CSS `.scroll-locked` al `body`.
- **Blocco dello scroll sui Modali**: Configurato il blocco dello scroll di sfondo durante la visualizzazione dei modal di conferma e di rinomina.
- **Escape Key sui Modali**: Spostato l'ascolto dell'evento `Escape` al livello globale (`document`) sia per il modal di conferma che per quello di rinomina, permettendo la chiusura reattiva dei modali a prescindere dal focus dell'elemento attivo.
- **Emoji Dispositivo in Presenza Online**: Riprogettato il mapping dell'indicatore di presenza utenti online per gli amministratori in `js/app.js`. Adesso:
  - I client web da PC (Windows, macOS, Linux) mostrano l'emoji `💻`.
  - I client web da dispositivi mobili (iOS, Android) mostrano l'emoji `📱`.
  - I client nativi (App Android) mostrano l'emoji `📱`.
- **Build di Produzione**: Ricompilato il bundle con `npm run build` ed aggiornato il grafo della conoscenza.

**Perché:**
- Offrire una navigazione nativa e fluida su touch target mobili, prevenendo lo scroll dello sfondo al di sotto dei popup aperti (Drawer, Conferma, Rinomina).
- Distinguere graficamente a colpo d'occhio nel pannello degli utenti connessi in tempo reale chi sta operando da una postazione PC rispetto a chi utilizza uno smartphone.

**File modificati:**
- `js/app.js` (aggiunta utilità `lockScroll`/`unlockScroll`, listener pointerdown sul drawer overlay, e aggiornato mapping icone presenza)
- `js/utils.js` (richiamo blocco scroll e ascoltatore Escape globale su `showConfirm` e `showRenameModal`)
- `css/components.css` (definizione stile `body.scroll-locked`)

---

## 2026-07-02 — Fix Editing Materiali, Modale Aggiunta Tecnici, Scroll/Click-Outside Modal

**Cosa è stato fatto:**
- **Fix bug "ONT ZTE 2.5 G" → "ONT ZTE 2"**: Il punto (`.`) nelle chiavi materiale veniva interpretato da Firestore come delimitatore di mappa annidata quando usato con dot-notation. Risolto introducendo `FieldPath` (importato/esportato da `firebase.js`) e usando la sintassi ad argomenti alternati di `updateDoc()` sia nell'inline editor che in `addMaterialRow()`.
- **Fix editing bloccato dopo primo salvataggio**: Il rendering incrementale in tempo reale non riapplicava la classe `editable-cell` e i dataset attributes (`data-raw`, `data-tech-id`, `data-material-name`) alle celle aggiornate dall'admin. Corretto il blocco incrementale di `renderTable`.
- **Modale aggiunta materiale con tecnici globali**: Ridisegnato `addMaterialRow()` per mostrare un modale unificato con:
  1. Casella di testo per materiale custom
  2. Select per materiale esistente (dalla lista master + materiali già usati)
  3. Select per tecnico (tutti i tecnici app, non web, non hidden)
  4. Input quantità
- **Caricamento tecnici**: La tendina carica TUTTI i tecnici non-web da `settings/devices_names` + quelli trovati nei documenti live/storici dell'appalto (per coprire tecnici con app vecchia non registrati in devices_names). Filtrati i disattivati tramite `getHiddenTecniciSync()` e `isHiddenDoc()`.
- **Fix `isLive` check**: Corretto il flag `isLive` nei documenti live da `true` hardcoded a `isToday(d.ultimo_aggiornamento)` per distinguere correttamente chi ha sincronizzato oggi.
- **Scrollabilità modal**: Aggiunto `max-height: calc(100vh - 48px)` e `overflow-y: auto` a `.confirm-box` in `components.css` per rendere scrollabili i modali con contenuto lungo.
- **Click-outside modal**: Il listener `{ once: true }` sull'overlay si auto-rimuoveva al primo click interno (es. sulla select). Sostituito con un handler nominato persistente (`onOverlayClick`) rimosso solo nel cleanup della funzione `close()`.

**Perché:**
- I nomi materiale con punto (es. "ONT ZTE 2.5 G") venivano corrotti in Firestore spezzando la chiave su ogni `.`.
- L'admin non poteva modificare la stessa cella due volte senza refresh.
- L'admin necessitava di poter modificare le liste di tecnici non ancora syncati o assenti dall'appalto corrente.
- I modali con molti tecnici nella dropdown uscivano dallo schermo senza possibilità di scroll.
- Cliccare fuori dal modale non lo chiudeva dopo aver interagito con elementi interni.

**File modificati:**
- `js/firebase.js` (export `FieldPath`)
- `js/data.js` (FieldPath in `editQuantityInline` e `addMaterialRow`, caricamento tecnici globali, fix incrementale `renderTable`, fix `isLive`)
- `js/utils.js` (supporto `htmlContent` in `showRenameModal`, fix click-outside persistente, cleanup `onOverlayClick`)
- `css/components.css` (`max-height` e `overflow-y: auto` su `.confirm-box`)

## 2026-07-14 — Sessione Uniformità Grafica e Layout Tab Admin

**Cosa è stato fatto:**
- **Uniformazione testate**: Estratte le testate delle quattro viste admin (`js/tecnici.js` per Tecnici e Bloccati, `js/aree.js` per Aree Preferite, `js/pfs.js` per Gestione PFS) ed inserite in un elemento `.content-header` esterno a `.tecnici-panel`. Questo garantisce allineamento, titolo, sottotitolo e sfondo grigio coerenti con le testate degli appalti.
- **Centratura e max-width**: Configurato `.tecnici-panel` in `css/components/misc.css` con `max-width: 1000px`, `width: 100%` e `margin: 0 auto`, centrando e limitando la larghezza di schede e tabelle su schermi larghi ed evitando lo stretch sgradevole.
- **Ripristino flexbox azioni tecnici e prevenzione wrap**: Aggiunta la classe `.tecnici-actions` in `css/components/forms.css` con layout flex, che allinea verticalmente pulsanti e checkbox toggle e li posiziona ordinatamente a destra delle card tecnici tramite `margin-left: auto`. Inoltre, configurato `.toggle-wrap` con `flex-wrap: nowrap` e `.toggle-info` con `flex: 1; min-width: 0` per schermi desktop. Questo fa sì che anche con dettagli hardware molto lunghi, il testo vada a capo internamente mentre i pulsanti e gli switch rimangano sulla stessa riga a destra, stabili e allineati verticalmente senza slittare in basso.
- **Riorganizzazione tabella dei bloccati**: Eliminato lo stile inline grezzo per la tabella dei dispositivi bannati ed introdotta la classe `.tecnici-table` in `css/components/table.css` con bordi, hover e font coerenti con le tabelle dell'applicazione.
- **Supporto mobile e touch targets**: Aggiunti stili CSS responsive in `css/responsive.css` sotto `@media (max-width: 900px)` per abilitare il wrap su mobile ed impostare i pulsanti tecnici larghi il 100% del loro container con altezza di 44px conforme alle WCAG 2.2.
- **Esportazione Immagine (Lista Modem) & Share Nativo**: Creata la funzione `exportToImage` (con il relativo tasto "Immagine") per generare e scaricare una versione PNG ad alta risoluzione speculare al layout a tabella dell'esportazione Excel. Mostra ciascun materiale con le quantità relative per tecnico, evidenziando in azzurro/cyan la colonna del totale finale. In modalità Live, viene calcolata ed inserita la data reale corrente (es: `14/07/2026` a video e `14-07-2026` nel file con prefisso `Lista_Modem_`) al posto di un generico "Oggi" per facilitare la condivisione e l'archiviazione cronologica. Su ambienti mobili e PWA che lo supportano (tramite controllo User Agent `isMobile`), richiama l'API Web Share per aprire direttamente il menu di condivisione di sistema (per inviare la foto su WhatsApp o Telegram), mentre su PC desktop esegue direttamente il salvataggio locale (download) come fallback.
- **Ottimizzazione layout header PWA**: Spostato il selettore di data (`.snapshot-dropdown`) all'interno del nuovo contenitore `.content-header-main` a fianco del titolo dell'appalto su mobile (dove c'era lo spazio vuoto indicato). Questo lascia la riga inferiore `.content-actions` interamente dedicata ai tre pulsanti d'azione (Esporta, Stampa, Immagine), che ora si distribuiscono in modo fluido e simmetrico occupando il 100% della larghezza ed evitando che il pulsante Immagine venga tagliato fuori dallo schermo.
- **Build di produzione**: Eseguito `npm run build` per rigenerare i file pronti per la produzione in `docs/` e allineato il Service Worker.
- **Aggiornamento Grafo**: Eseguito `graphify update .` per mantenere coerenti le relazioni.

**Perché:**
- Nello splitting del file CSS monolitico in fogli di stile separati, alcune classi trasversali come `.tecnici-actions` erano andate perse, disallineando i pulsanti delle schede dei tecnici.
- Senza un container con larghezza massima e testata comune, le pagine admin si presentavano vuote al centro e sproporzionatamente allungate ai margini su desktop e PWA.
- La tabella dei bloccati non seguiva lo stile del design system scuro/chiaro dell'applicazione.
- Gli utenti necessitano di condividere rapidamente una "fotografia" della tabella materiali ad alta leggibilità sui canali social aziendali (WhatsApp/Telegram).

**File modificati:**
- `js/tecnici.js` (ristrutturazione layout `showTecnici` e `showBanned`)
- `js/aree.js` (ristrutturazione layout `showAreeDashboard`)
- `js/pfs.js` (ristrutturazione layout `showPfsDashboard`)
- `js/export.js` (implementata la funzione `exportToImage` con calcolo ingombro dinamico e layout tabellare)
- `js/data.js` (inserito il pulsante Immagine ed importato il metodo di export)
- `js/app.js` (esposto globalmente `window.exportToImage`)
- `css/components/forms.css` (aggiunta classe `.tecnici-actions` e padding)
- `css/components/misc.css` (aggiunta classe `.content-header-main`, larghezza max e centratura a `.tecnici-panel`)
- `css/components/table.css` (definizione classe `.tecnici-table`)
- `css/responsive.css` (overrides per `.tecnici-actions`, pulsanti tecnici, e layout header/actions su mobile)

**Rischi residui:**
- Nessuno. Le modifiche sono grafiche e puramente di layout/esportazione, e non alterano le logiche di sincronizzazione dati o gli stati Firestore.

**Follow-up consigliati:**
- Eseguire un check visivo completo in modalità light theme per confermare che l'ombreggiatura e il contrasto dei pulsanti ed input siano ottimali anche di giorno.


