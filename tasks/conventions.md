# Convenzioni di Codice e Architettura — Dashboard (tchwrk2)

Questo documento definisce le convenzioni reali utilizzate nel codebase della Dashboard. Devono essere seguite rigorosamente da qualsiasi agente AI o sviluppatore per garantire coerenza ed evitare regressioni.

---

## 1. Naming Conventions

* **File JavaScript:** camelCase o lowercase, es. `app.js`, `pfsLookup.js`, `tecnici.js`. Tutti posizionati sotto `js/`.
* **File CSS:** lowercase, es. `variables.css`, `components.css`, `themes.css`, `responsive.css`. Sotto `css/`.
* **Funzioni / Metodi:** camelCase descrittivo, es. `doLogin()`, `loadAppalto()`, `renderTecnici()`, `getHiddenTecniciSync()`, `stopAreeListener()`.
* **Variabili / Parametri:** camelCase, es. `currentAppalto`, `currentDate`, `appaltiData`, `deviceId`.
* **Costanti Globali o di Configurazione:** UPPER_SNAKE_CASE, es. `APPALTI`, `USERS`, `MAX_VISIBLE_ITEMS`, `BRAND_FILES`.
* **ID ed Elementi HTML:** kebab-case per componenti strutturali, es. `offline-banner`, `topbar-online`, `kpi-total`, `confirm-overlay`. Per elementi dinamici associati ad entità si usa la forma `nav-{appalto}` o `cnt-{appalto}` o `loc-{tecnicoId}`.
* **Classi CSS:** kebab-case, es. `btn-outline`, `tecnici-panel`, `toggle-wrap`, `btn-tecnico-action`.

---

## 2. Architettura — Dove Vive la Logica

L'applicazione è una **Single Page Application (SPA)** in puro JavaScript Vanilla (nessun framework UI) strutturata come segue:

* **Entry Point (`js/app.js`):** Inizializza l'interfaccia, gestisce l'Hash Router (`handleHashChange`), orchestra i listener globali di presenza online (RTDB) ed esegue il cleanup dei listener specifici delle viste al cambio tab.
* **Stato Condiviso (`js/state.js`):** Contiene le costanti predefinite, l'utente correntemente loggato e le variabili globali reattive (`currentAppalto`, `currentDate`). Carica la configurazione da GitHub con cache locale a 24 ore.
* **Inizializzazione Firebase (`js/firebase.js`):** Carica l'SDK Firebase tramite CDN (gstatic) ed esporta i metodi di Firestore e Realtime Database, centralizzando la dipendenza.
* **Moduli di Vista (es. `js/tecnici.js`, `js/pfs.js`, `js/aree.js`, `js/pfsLookup.js`, `js/data.js`):** Ciascun modulo è responsabile del fetching dei dati, del rendering del proprio HTML e del tracking dei propri listener attivi in array locali (es. `_tecniciListeners`). Esportano funzioni di rendering (es. `showTecnici()`) e funzioni di cleanup dei listener (es. `stopTecniciListeners()`).
* **Modulo Dati Core (`js/data.js`):** Gestisce il caricamento principale delle tabelle materiali degli appalti, i filtri, i calcoli KPI, i mini-editor inline e i badge contatori.
* **Utilità e Dialog (`js/utils.js`):** Contiene helper generici di formattazione temporale, escaping per XSS, e i dialog interattivi globali (`showToast`, `showConfirm`, `showRenameModal`).

---

## 3. Gestione dello Stato e Firebase

### 3.1 Real-Time (onSnapshot / onValue) vs Statico (getDocs)
* **Live Update:** La tab attiva dell'appalto e i pannelli admin (Tecnici, PFS, Aree) ascoltano in real-time tramite `onSnapshot` o `onValue`.
* **Storico (Snapshot):** Le visualizzazioni di date passate (es. `2026-05-12`) usano query statiche `getDocs` con filtri stringa (`endsWith`) per minimizzare il consumo di letture Firebase.

### 3.2 Prevenzione Memory Leak e Sovrascritture DOM
Ogni modulo che attiva listener real-time deve:
1. Registrare gli unsubscriber in un array di modulo (es. `_tecniciListeners`).
2. Esportare una o più funzioni di stop (es. `stopTecniciListeners()`) che iterano l'array invocando le funzioni di disiscrizione e svuotando l'array.
3. Chiamare la funzione di stop all'inizio dell'inizializzazione della vista per evitare listener duplicati.
4. Consentire al router in `app.js` di chiamare queste funzioni all'inizio di `handleHashChange` prima di cambiare vista.

### 3.3 Cache Sincrona in RAM
Per evitare chiamate asincrone ripetute (`getDoc`) a Firestore all'interno di loop di rendering sincroni (come i badge della sidebar o le righe della tabella):
* Mantenere una cache sincrona locale (es. `_hiddenCache` per i tecnici disattivati).
* Popolare e tenere aggiornata questa cache tramite un listener `onSnapshot` centralizzato ad avvio app.
* Esporre metodi sincroni immediati (es. `getHiddenTecniciSync()`) per accedere ai dati.

---

## 4. Gestione Errori e Interazione Utente

### 4.1 Gestione delle Exception
* Avvolgere sempre in blocchi `try/catch` le scritture e letture su database, le chiamate a `localStorage` (evita crash in modalità navigazione privata di Safari) e le callback asincrone dei listener Firebase.
* In caso di errore non bloccante, loggare su `console.error` e presentare all'utente un feedback amichevole tramite `showToast` con stile `error`.

### 4.2 Dialogs e Sicurezza XSS
* Usare il metodo `showConfirm({ title, msg, icon })` per le conferme distruttive.
* Di default, `showConfirm` esegue l'escape del testo del messaggio. Se è necessario includere codice HTML (es. select box per assegnare/rinominare tecnici), passare il flag esplicito `asHtml: true` e assicurarsi che le singole variabili inserite nel markup siano state preventivamente passate attraverso `escapeHtml()`.
* Per i toast, se si usa `asHtml: true` in `showToast`, applicare sempre l'escaping preventivo alle stringhe variabili provenienti da Firestore o input utente.

---

## 5. Commenti e Stile del Codice

* Scrivere i commenti in **italiano**.
* Utilizzare intestazioni visive con caratteri Unicode per organizzare il codice nei file principali:
  ```javascript
  // ── HASH ROUTER ──
  // ── EVENT LISTENERS ──
  ```
* Evitare commenti ovvi. Documentare il *perché* di scelte non immediate (es. motivazioni dietro una cattura dello stato o una temporizzazione).

---

## 6. Test, Verifica e Build

### 6.1 Sviluppo Locale
* Avviare il server di sviluppo locale tramite il comando `npm run dev` o eseguendo lo script batch `avvia_progetto.bat`.

### 6.2 Build di Produzione
* Prima di considerare concluso qualsiasi intervento o fare il push, è obbligatorio compilare l'applicazione per verificare l'assenza di errori del bundler e aggiornare la cartella di distribuzione:
  ```powershell
  npm run build
  ```
* La build genera i file statici ottimizzati e aggiorna il Service Worker della PWA in `docs/`.

### 6.3 Aggiornamento del Grafo
* Dopo aver modificato file di codice, eseguire sempre l'aggiornamento del Knowledge Graph per allineare l'AI:
  ```powershell
  # Impostare le variabili d'ambiente caricate da KEYS.md, quindi:
  graphify update .
  ```

---

## Storico Modifiche a Questo File

* **2026-07-04 — Compilazione delle Convenzioni Reali:** Popolato il file con le convenzioni reali del progetto dedotte dal codice (naming camelCase, architettura Vanilla SPA Hash Router, gestione asincrona e stop dei listener Firebase, caching sincrono in RAM per i tecnici nascosti, e procedure di build).
* **2026-07-04 — Aggiunta Sezione CSS Splitting, Sottoscrizioni Pub/Sub e Custom Dropdowns:** Documentate le linee guida per la modularizzazione dei fogli di stile, la centralizzazione dei listener Firebase mediante Pub/Sub e l'uso di selettori personalizzati HTML/CSS/JS nei dialoghi.

---

## 7. Convenzioni Avanzate UI & Ottimizzazione Listener

### 7.1 Splitting CSS Modulare
* **Gestione degli Stili**: Evitare fogli di stile monolitici giganti. Dividere il CSS in file specifici per componente sotto `css/components/` (es. `forms.css`, `table.css`, `modal.css`).
* **Import centralizzato**: Il file principale `css/components.css` deve contenere esclusivamente dichiarazioni `@import` ordinate per importare i singoli fogli di stile. La compilazione con Vite si occuperà di aggregare e minimizzare i file nel bundle di produzione.

### 7.2 Pattern Pub/Sub Centralizzato per Firebase (onSnapshot)
* **Prevenzione Spreco Letture**: Per documenti o impostazioni letti in parallelo da più tab o moduli (es. `settings/devices_names` usato da online indicator, pfsLookup, tecnici e aree), **mai** aprire listener `onSnapshot` indipendenti.
* **Listener Globale**: Inizializzare un unico listener reattivo globale in `state.js` all'avvio dell'applicazione.
* **Metodi di Iscrizione**: Esporre `subscribeToDevicesNames(key, callback)` e `unsubscribeFromDevicesNames(key)` per consentire a ciascun modulo di agganciare la propria callback all'aggiornamento dei dati in cache, azzerando le chiamate di rete superflue.

### 7.3 Custom Select Dropdowns
* **Grafica Uniforme**: I tag `<select>` nativi non supportano stili complessi (come gradienti, angoli smussati e background del menu a comparsa personalizzati).
* **Componente Custom**: Usare il componente custom HTML/CSS/JS `.custom-select` composto da un trigger button, una lista a comparsa di opzioni `.select-options-list` ed un tag input nascosto `<input type="hidden">`.
* **Tracciamento Valore**: Il tag `<input type="hidden">` deve ospitare l'ID del selettore. Questo consente alla logica JS del modale (es. `document.getElementById('rename-tech-select').value`) di leggere il valore selezionato senza alcuna modifica al codice logico dei dialoghi.
* **Eventi Click e Outside**: Usare le funzioni globali `toggleCustomSelect(event, btn)` e `selectCustomOption(btn)` esposte su `window` per gestire l'interattività, assicurando anche un listener su `document` per nascondere i menu aperti quando l'utente fa click in un punto vuoto dello schermo.

