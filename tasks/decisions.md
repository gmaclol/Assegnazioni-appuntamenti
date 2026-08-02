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

