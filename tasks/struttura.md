# struttura.md — Assegnazioni Appuntamenti

## 1. Architettura Generale

**Pattern:** SPA Vanilla JS + Module Bundler Vite + PDF.js + ExcelJS + Firestore REST + Nominatim Geocoding

**Layer Applicativi:**

| Layer | Descrizione | File |
|-------|-------------|------|
| Entry Point UI | HTML principale e componenti di layout, topbar, toolbar e modale di riepilogo | `index.html` |
| Design System | Variabili CSS, tema scuro, stili custom dropdown selettore tecnici e z-index | `css/style.css` |
| Controller / Orchestrator | Gestione stato locale, eventi Drag & Drop, render tabelle, selettore custom, ottimizatore rotte `optimizeAssignments` | `js/app.js` |
| PDF Parser | Estrazione e parsing token dai Work Order Open Fiber (Elecnor, Sertori, Sirti), normalizzazione apparati, estrazione telefoni | `js/pdfParser.js` |
| Excel Generator | Generazione file `.xlsx` identico al modello aziendale con celle orario formattate | `js/excelGenerator.js` |
| Dashboard Integrata | Gestione posizione di casa dei tecnici Android per i calcoli di percorso | `C:\Users\Rosti\Desktop\tchwrk2` |
| Deploy & Build | Configurazione Vite per GitHub Pages | `vite.config.js` |
| Scripts Windows | Script batch per avvio server dev ed aggiornamento GitHub | `avvia_progetto.bat`, `aggiorna_github.bat` |

---

## 2. Flussi Dati Principali

1. **Upload Work Order PDF**:
   - L'utente trascina o seleziona uno o più PDF di Open Fiber (Elecnor / Sertori / Sirti).
   - `pdfParser.js` estrae il testo tramite `pdfjs-dist`, raggruppa le pagine per codice WR e ricava orario, cliente, telefono `(numero)`, indirizzo, comune, centrale/POP/TOH, operatore OLO, apparati (es. `cpe3` senza sfp inventato) e note.

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
   - Modal custom (`#techManagerModal`) con ricerca in tempo reale.
   - Permette di spuntare la presenza/ferie del tecnico, assegnare il ruolo (`Normale`, `Guasti Cluster A/B`, `Guasti Cluster C/D`) e scegliere un colore custom per il badge visivo.
   - I dati vengono salvati in `localStorage` (`tw_tech_settings_v1`) e sincronizzati online su Firestore `settings/assegnazioni_web` (campo `data`), caricati all'avvio e scritti con debounce (800ms).

6. **Gestore Aziende Appalto**:
   - Pannello topbar (`#companyPanel`) per aggiungere/rimuovere aziende di appalto in tempo reale.
   - Ogni riga della tabella contiene una `<select>` dinamica sincronizzata con la lista aziende.
   - I dati vengono salvati in `localStorage` (`tw_companies_v1`).

7. **Esportazione Excel**:
   - Cliccando su "Esporta Excel", `excelGenerator.js` compila il foglio `.xlsx` formattato con i colori delle fasce orarie, sfondo grigio per i guasti e testo rosso per la Borchia.

