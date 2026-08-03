# lessons.md — Dashboard (tchwrk2)

## Errore: Write Amplification da Color Picker (eventi `input` continui)
**Causa:** Il color picker del modal tecnici emette eventi `input` in continuazione mentre l'utente trascina il selettore; salvare su Firestore ad ogni evento genererebbe decine di scritture al singolo cambio colore.
**Regola:** Quando un controllo UI emette eventi ad alta frequenza (color picker, slider, input di ricerca) e si scrive su Firestore, usare sempre un debounce (es. 800ms) sulla scrittura remota, mantenendo eventualmente il salvataggio locale (`localStorage`) immediato. Le scritture remote vanno sempre user-triggered e raggruppate.


## Errore Toast HTML
I toast nativi custom `showToast` facevano per design l'escape HTML dei messaggi per limitare XSS. Volendo implementare grassetti `<br>` e `<b>` per le notifiche, le tag apparivano come plaintext.
*Soluzione:* Invece di far passare stringhe libere pericolose (nomi tecnici/indirizzi inseriti da utente), l'architettura sicura è:
1. `utils.js -> showToast` accetta un flag opzionale `asHtml = true`.
2. Il modulo chiamante (es. `pfs.js`) DEVE lanciare `escapeHtml(utente)` sulle singole variabili "pericolose", E POI concatenarle nei tag.

## Errore Sincronizzazione DOM con Listener Real-Time
Cambiando chiamate `getDocs` statiche con eventi background `onSnapshot`, l'interfaccia si rigenera da sola imprevedibilmente. Se l'utente in quel momento:
- Ha un input di testo a fuoco (es. Aree).
- Ha spuntato checkbox per bulk-delete (es. PFS).
Tutto viene perso dal reset `.innerHTML`.
*Soluzione:* Pattern di "Capture and Restore": catturare ID/Active element e stato check prima del render, ri-applicare le checkbox e `element.focus()` subito dopo l'inserimento DOM.

## Errore Memory Leak Firebase
Aprire un `onSnapshot` nella renderizzazione di una tab crea connessioni aperte persistenti. Cambiare tab decine di volte apriva centinaia di WebSocket paralleli uguali (consumando reads e batteria client).
*Soluzione:* Qualsiasi modulo che definisce `onSnapshot` deve esportare una function `stopListeners()`. L'entry point `app.js` che fa l'Hash-Routing è incaricato di chimare tutte le `stopListeners()` alla destituzione della rotta precedente.

## Errore Distruzione Listener Globali
Applicando ciecamente il pattern di cui sopra, è stato ucciso anche il listener globale della sidebar (`_favsListener`) durante la navigazione tra i tab (`stopPfsLookupListener`). Questo rendeva la sidebar sorda agli aggiornamenti di Firestore finché non si tornava alla rotta originale.
*Soluzione:* I listener che guidano componenti UI persistenti e globali (come sidebar, topbar) NON devono essere dismessi dal router, ma devono rimanere attivi per l'intero ciclo di vita dell'applicazione.

## Errore Race Condition Sovrascrittura Dati (Merge: True)
Quando un componente carica dati locali e poi spinge un payload massivo usando `setDoc(..., {merge: true})` al caricamento della pagina (es. `registerWebUser`), rischia di sovrascrivere campi modificati di recente da un altro client se il payload inviato contiene campi non strettamente di sua competenza (es. mandare `name: originalName` sovrascriveva il rename dell'admin; mandare `pfsAreas: localFavs` sovrascriveva le preferenze aggiornate dall'admin).
*Soluzione:* Isolare rigorosamente le responsabilità di scrittura. Un tracker hardware (`registerWebUser`) deve spingere solo metadati tecnici (`os`, `browser`, `baseName`) e *mai* le impostazioni personalizzate gestite da altri moduli, affidandosi ai listener per la ricezione passiva di quelle impostazioni.

## Errore UI Button Affordance
Un'azione primaria nella sidebar ("Ricerca PFS") era stata inserita come semplice etichetta di testo (link testuale), riducendo la percezione di interattività (affordance) per l'utente.
*Soluzione:* Utilizzare sempre stili chiari per le call-to-action (es. classe `btn-outline` con colori d'accento) affinché siano palesemente riconoscibili come bottoni interattivi, in modo coerente col resto della UI.

## Errore Tooltip Nativo su Mobile (Title Attribute)
Affidare informazioni importanti all'attributo nativo `title` funziona su desktop (hover) ma fallisce su PWA e dispositivi mobile. Tenere premuto un elemento con `title` tipicamente innesca il context-menu nativo (selezione testo o opzioni) o non mostra nulla.
*Soluzione:* Creare tooltip personalizzati in CSS/JS gestiti tramite eventi `pointerdown`, `pointerup` e `pointerleave`. Inoltre, per supportare la gesture di "hold" (pressione lunga) senza distrazioni, occorre disabilitare il menu contestuale nativo tramite `e.preventDefault()` su `contextmenu` e usare le regole CSS `-webkit-touch-callout: none; user-select: none;`.

## Errore Crash Ricerca iOS e Accessibilità
Crash o freeze dell'interfaccia PWA su iOS Safari digitando rapidamente nell'input di ricerca PFS. Inoltre layout mobile instabile a causa dell'auto-zoom di iOS e header/sidebar sovrapposti dalle tacche/home bar dell'iPhone, con la sidebar che ignorava il tema light.
*Soluzione:*
1. Implementato un meccanismo di *debounce* (`setTimeout` / `clearTimeout`) sulle funzioni `oninput` che rigenerano massivamente il DOM in risposta a filtri o regex.
2. Forzato globalmente il `font-size: 16px !important` su `<input>` e similari in `@media (max-width: 900px)` per inibire il fastidioso comportamento nativo di zoom di iOS.
3. Integrato `env(safe-area-inset-top)` e `env(safe-area-inset-bottom)` per padding e margini dei componenti full-screen per PWA stand-alone.
4. Applicate regole specifiche nel tema `light` e garantita l'area tocco minima di 44x44px.

## Errore Billing Spike Firestore (Reads e Writes)
Un numero eccessivo di letture (20k+) e scritture sono state generate dalla web dashboard, minacciando i limiti della free tier.
*Causa 1 (Reads):* `onSnapshot()` eseguito in background su intere collection solo per popolare i badge numerici della sidebar. Questo scaricava migliaia di documenti storici ad ogni avvio o cambio data.
*Causa 2 (Writes):* Sistema di "Utenti Online" implementato tramite Firestore con un `setInterval` client-side di 45 secondi, che produceva ~1920 scritture al giorno per ogni singola tab aperta.
*Soluzione:* 
1. **Reads**: Non fare MAI `onSnapshot` globale su collection intere senza filtri limitanti. Popolare i count in modo asincrono solo per la tab attiva.
2. **Writes**: Non usare MAI Firestore per un sistema di "Presence". Utilizzare sempre **Firebase Realtime Database (RTDB)** tramite gli eventi `.info/connected` e `onDisconnect()` lato server, che non addebitano costi per le scritture di connessione.
3. **Disconnessioni Fantasma su Mobile**: RTDB `onDisconnect` è debole su mobile perché l'OS "congela" l'app in background (es. tornando alla Home iOS/Android) senza chiudere il WebSocket TCP. Questo lascia sessioni zombie finché il server timeout non scade. Per risolverlo: intercettare globalmente `document.addEventListener('visibilitychange')` ed eseguire disconnessione / offline logico quando la pagina passa a `hidden`, riconnettendo su `visible`.

## Errore Write Amplification in Listener Real-Time
`checkStaleHashes()` veniva invocata dentro il callback `onSnapshot` del live listener. Ogni modifica a qualsiasi documento nella collection scatenava una lettura + scrittura su `settings/stale_hashes`. Con N tecnici × M sync/giorno × K dashboard aperte, le write crescevano in modo moltiplicativo.
*Causa:* Mancanza di separazione tra logica di "primo caricamento" e logica di "aggiornamento real-time". Le operazioni di hashing/confronto devono essere one-shot, non reattive.
*Regola:* **Mai piazzare `setDoc`/`updateDoc` dentro un callback `onSnapshot`** a meno che non sia strettamente user-triggered. Se serve una write automatica (es. calcolo hash), farla **una volta sola** e cachare il risultato.

## Errore Write Ridondanti su Page Load
`registerWebUser()` scriveva su Firestore ad ogni apertura pagina perché `updatedAt: Date.now()` produceva sempre un valore diverso. Inoltre, ogni write su `settings/devices_names` cascadava su 2-4 listener simultanei, amplificando le reads.
*Regola:* Per le registrazioni idempotenti (dati che non cambiano durante una sessione), usare `sessionStorage` come guardia per evitare write ripetute. I dati hardware (OS, browser) non mutano tra un refresh e l'altro.

## Errore: Crash di WebKit/Safari su iOS con liste DOM massicce (~5000+ nodi)
**Causa:** L'iniezione diretta di migliaia di righe strutturate HTML nel DOM (es. `content.innerHTML = ...`) per file JSON di aree geografiche molto estese (es. Roma ~5800 PFS) satura istantaneamente la RAM allocata dal rendering engine mobile di WebKit, portando a freeze o crash immediati dell'app.
**Regola:** Quando si renderizzano liste potenzialmente massive sul web (specialmente su mobile), implementare sempre un pattern di **paginazione/caricamento incrementale** ("Mostra altri"). Memorizzare l'intero dataset in RAM (dove consuma pochissima memoria) e limitare a un blocco ristretto (es. `MAX_VISIBLE_ITEMS = 100`) il numero massimo di elementi fisicamente iniettati nel DOM in una sola operazione, offrendo all'utente la possibilità di caricare progressivamente i blocchi successivi al click.

## Errore: Rinfreschi manuali distruttivi e sfarfallio UI (Real-Time non reattivo)
**Causa:** Chiamare esplicitamente funzioni di caricamento (es. `showTecnici()`) e distruzione listener (`clearCountListeners()`) all'interno di eventi locali (es. deattivazione o rinomina) annulla i vantaggi di Firebase. Questo causa un reset completo del DOM, mostrando momentaneamente una schermata di caricamento e sprecando reads Firebase.
**Regola:** Le modifiche locali devono limitarsi ad aggiornare Firestore. Saranno i listener `onSnapshot` attivi a intercettare la modifica e aggiornare la UI in modo reattivo e trasparente.

## Errore: Letture asincrone getDoc ripetute in rendering sincroni
**Causa:** Chiamare `await getHiddenTecnici()` (che esegue `getDoc` sul DB) all'interno di funzioni di rendering sincrone o calcoli asincroni per ciascun badge sidebar rallenta le risposte e genera traffico di rete inutile.
**Regola:** Mantenere una cache sincrona in RAM (es. `_hiddenCache`) aggiornata in tempo reale tramite un singolo listener `onSnapshot` centralizzato ed esporre funzioni sincrone immediate (es. `getHiddenTecniciSync()`) per velocizzare i calcoli UI.

## Errore: Script PowerShell corrotto file app.js durante modifica
**Causa:** Un esperimento di sostituzione regex in PowerShell ha troncato `js/app.js` a 0 byte, causando la perdita dell'intero file.
**Regola:** NON usare sostituzioni regex complesse in PowerShell su file JavaScript con caratteri Unicode (──). Preferire lo strumento `edit` per modifiche chirurgiche. Se serve manipolazione massiva, leggere il file intero in memoria, modificare, riscrivere.

## Errore: showConfirm() con euristica HTML bypassabile
**Causa:** `showConfirm` usava `msg.includes('<') && msg.includes('>')` per decidere innerHTML vs textContent. Qualsiasi messaggio contenente entrambi i caratteri `<>` veniva interpretato come HTML, consentendo XSS.
**Regola:** Mai usare euristiche di markup per decidere innerHTML vs textContent. Usare sempre textContent di default con flag `asHtml` esplicito per i casi che necessitano HTML (pattern già usato da `showToast`).

## Errore: `.toFixed()` su valori potenzialmente undefined da Firestore
**Causa:** `l.lat.toFixed(5)` in `pfs.js` senza controllare che `l.lat` e `l.lng` esistano. I log PFS legacy possono non avere coordinate, causando crash su `TypeError: Cannot read properties of undefined (reading 'toFixed')`.
**Regola:** Prima di chiamare `.toFixed()` su dati Firestore, verificare sempre con `l.lat != null && l.lng != null`.

## Errore: `currentAppalto` letto dopo `await` in callback asincrona
**Causa:** `finishEdit()` in `data.js` importava `currentAppalto` con `await import('./state.js')` DOPO l'operazione asincrona di salvataggio. Se l'utente cambiava tab prima che la promise risolvesse, la scrittura andava sull'appalto sbagliato.
**Regola:** Catturare i valori di stato (`currentAppalto`) all'inizio della funzione, prima di qualsiasi `await`. Non fare dynamic import di moduli già importati staticamente.

## Errore: Duplicazione listener `controllerchange` in app.js
**Causa:** Due blocchi distinti registravano `navigator.serviceWorker.addEventListener('controllerchange', ...)`. Il primo senza guardia `refreshing`, causando `window.location.reload()` multiplo.
**Regola:** Quando si registrano listener Service Worker, assicurarsi che siano unici. Usare sempre il pattern con guardia `refreshing`.

## Errore: Dynamic import ridondanti
**Causa:** `data.js` importava `updateDoc` e `deleteField` con `await import('./firebase.js')` in 4 funzioni (`addMaterialRow`, `editMaterialRow`, `deleteMaterialRow`, `finishEdit`), nonostante avesse già import staticamente altri simboli da `firebase.js`.
**Regola:** Aggiungere tutti i simboli necessari all'import statico in cima al file. I dynamic import sono giustificati solo per lazy-loading, non per simboli già disponibili.

## Errore: `window.open()` senza null guard
**Causa:** `export.js` chiamava `win.document.write(html)` su `const win = window.open(...)` senza verificare che `win` non fosse `null`. I popup blocker bloccano la finestra, causando crash.
**Regola:** Controllare sempre `if (!win) return` dopo `window.open()`.

## Errore: `appearance: none` senza prefisso iOS
**Causa:** `.select-fancy` e `.tech-nav-left` usavano solo `appearance: none` senza `-webkit-appearance: none`, causando rendering nativo errato su Safari iOS.
**Regola:** Accanto a `appearance: none` aggiungere sempre `-webkit-appearance: none`.

## Errore: `100vh` su iOS causa overflow layout
**Causa:** `height: 100vh` su iOS include la barra degli indirizzi ma esclude la home indicator, causando contenuto tagliato in basso.
**Regola:** Usare `100dvh` (dynamic viewport height) invece di `100vh` su mobile.

## Errore: `localStorage` senza try/catch in private browsing
**Causa:** Molte chiamate `localStorage.setItem/getItem/removeItem` in `state.js`, `auth.js`, `data.js`, `pfsLookup.js` non avevano try/catch. Safari in private browsing lancia QuotaExceededError.
**Regola:** Ogni operazione su `localStorage` DEVE essere avvolta in try/catch, specialmente in PWA che girano su iOS Safari.

## Errore: `escapeHtml()` non importato in moduli che fanno rendering
**Causa:** `pfsLookup.js`, `aree.js`, `app.js` non importavano `escapeHtml()`, nonostante facessero rendering di dati Firestore in innerHTML. Le vulnerabilità XSS erano diffuse.
**Regola:** Ogni modulo che manipola innerHTML con dati da Firestore o input utente DEVE importare e usare `escapeHtml()`.

## Errore: Async callback dentro `onSnapshot` senza try/catch
**Causa:** Il callback `async` di `onSnapshot` in `data.js` chiamava `fetchRawMasterList()` e `checkStaleHashes()` senza try/catch. Se una promise interna falliva (errore rete), la rejection era silenziosa.
**Regola:** Ogni callback `async` passato a `onSnapshot`/`onValue` deve avere un try/catch esterno che gestisca gli errori interni.
## Errore: Filtro tecnici nascosti non valutava deviceId per cortocircuito OR logico
**Causa:** Il filtro `.filter(d => !hidden.includes(d.tecnico || d.id))` valuta l'espressione `d.tecnico || d.id` prima di passarla ad `includes`. Dato che `d.tecnico` (stringa nome) è praticamente sempre *truthy*, `d.id` non verrà mai valutato e il filtro fallirà se il nome utente non fa match perfetto con quello nella lista `hidden`.
**Regola:** Quando bisogna controllare la presenza di più proprietà alternative in un array, non passare un OR logico come parametro; invece, usa un controllo esplicito su entrambe le proprietà o crea una funzione helper come `isHiddenDoc(d, hidden)` che controlli indipendentemente `hidden.includes(d.tecnico)` e `hidden.includes(d.id)`. In aggiunta, usare il `toLowerCase()` durante i controlli stringa per prevenire bug case-sensitive.

## Errore: Errato parsing del window.location.hash ed elemento topbar non sincronizzato
**Causa:** Il router SPA in `app.js` faceva `hash.slice(1).split('/')` per ricavare la rotta. Poiché gli URL interni iniziano con il prefisso `#/` (es. `#/appalti/Sertori/live`), la slice restituiva una stringa che inizia con `/`. Lo splitting generava come primo elemento un valore vuoto (`""`), facendo shiftare tutti i parametri di rotta (lo schema caricava `"appalti"` come nome azienda e `"Sertori"` come data snapshot). Inoltre, l'elemento topbar `#tb-appalto` non veniva aggiornato in risposta ad un evento `hashchange` ma solo su click diretto tramite `selectAppalto()`.
**Regola:** Quando si parsa l'hash router, estrarre il path rimuovendo esplicitamente il prefisso `#/` prima di fare split (ad es. `hash.startsWith('#/') ? hash.slice(2) : hash.slice(1)`). Sincronizzare sempre tutti gli elementi globali dell'interfaccia (come i titoli del visualizzatore attivo in topbar) all'interno dell'handler centrale di routing.

## Errore: Icona theme toggle vuota, contatore online non visualizzato, e hold non funzionante su PWA
**Causa:**
1. Il pulsante cambia tema `.btn-theme` non conteneva testo né icone hardcoded nell'HTML e mancava di uno pseudo-elemento CSS associato per caricare l'immagine o il carattere dell'icona, risultando in un cerchio vuoto invisibile su PWA/mobile.
2. L'indicatore di presenza utenti online `#topbar-online` era preimpostato in HTML con `style="display:none;"` per impedire la visualizzazione pre-login. Tuttavia, le routine di presenza in `app.js` aggiornavano solo il testo e i badge interni senza rimuovere o sovrascrivere lo stile inline di nascosto, lasciandolo invisibile per gli amministratori.
3. Il tooltip custom `.online-tooltip` per visualizzare la lista degli utenti connessi in tempo reale su dispositivi mobili non era fisicamente inserito nell'HTML dell'indicatore di presenza e non c'erano i listener eventi pointerdown/pointerup associati per attivare la classe `.show` al tocco prolungato (hold), limitando il funzionamento solo su desktop con hover nativo `title`.
4. Nel modulo router in `app.js`, le chiamate a `showBanned()` e `showPfsRegionBrowser()` venivano scatenate tramite i riferimenti globali `window.showBanned` e `window.showPfsRegionBrowser`, ma queste funzioni non erano state importate nel modulo `app.js` né registrate sull'oggetto globale `window`, bloccando indefinitamente il caricamento delle rotte `/admin/banned` e `/pfs-lookup`.
**Regola:**
1. Assicurarsi che tutti gli elementi UI basati su iconografia abbiano uno stile CSS definito con pseudo-elementi (`::before` / `::after`) o SVG nativi per prevenire elementi vuoti o invisibili.
2. Quando un elemento UI viene nascosto condizionalmente all'avvio tramite attributi inline `style="display:none;"`, assicurarsi che la logica JS gestisca esplicitamente l'aggiornamento della proprietà `display` (`flex`, `block`, etc.) in tutti i flussi di attivazione e disattivazione.
3. Su mobile/PWA, per i componenti informativi complessi, evitare di basarsi sull'attributo HTML nativo `title` (non visualizzabile al tocco/hold). Creare un tooltip HTML dedicato all'interno del DOM e controllarlo via JavaScript con eventi `pointerdown` (chiamando anche `e.preventDefault()` su `contextmenu` per prevenire menu contestuali nativi dell'OS), `pointerup` e `pointerleave`.
4. Evitare l'utilizzo dell'oggetto globale `window` per invocare metodi di moduli diversi in un'applicazione basata su ES Modules. Importare sempre in modo esplicito le funzioni necessarie in cima ai moduli JavaScript che le consumano e invocarle direttamente.

## Errore: Filtraggio distruttivo dei tecnici nascosti impediva la vista opacizzata Admin (`data.js`)
**Causa:** La funzione `triggerTableRenderWithHidden()` e il primo filtro di `loadAppalto()` eseguivano `.filter(d => !isHiddenDoc(d, hidden))` indiscriminatamente sia per gli utenti comuni che per gli Admin. Di conseguenza, nascondere un tecnico rimuoveva la colonna dalla tabella anche per l'Admin, anziché lasciarla visibile con opacità ridotta. Inoltre, l'algoritmo di rendering incrementale `canIncrement` non rilevava i cambi di opacità/stato se i nomi dei tecnici rimasti coincidevano con quelli memorizzati in `_lastRenderedKey`.
**Regola:** 
1. Nel filtering dei documenti per la tabella, considerare sempre il ruolo dell'utente (`currentUser.role === 'admin'`). Se l'utente è Admin, preservare il documento impostando una flag interna (es. `d._isHiddenByAdmin = true`) da sfruttare in fase di rendering per applicare lo stile `opacity: 0.45` ed il tasto `Riabilita Lista`.
2. Ogni volta che si modifica lo stato di visibilità o la struttura della tabella (es. `toggleHideTecnico()`), impostare `_lastRenderedKey = null` prima del re-render per forzare la ricostruzione completa del DOM della griglia.

## Errore: Rimozione o modifica di righe materiali standard (Modem / ONT, ecc.)
**Causa:** L'amministratore poteva rinominare o eliminare per errore le righe di materiali standard dell'appalto definiti nella master list (da `lista.txt` o `Nomeappalto.txt` scaricate da GitHub), creando incoerenze nel tracciamento dei cantieri. Inoltre, il modal di conferma (`showConfirm`) utilizzava internamente `.textContent` su `confirm-msg` troncando qualsiasi elemento HTML inserito come parte del messaggio (come la select del tecnico).
**Regola:** 
1. I materiali standard non devono essere modificabili o eliminabili. Verificare sempre se il materiale appartiene al master list scaricato e bloccare l'operazione restituendo un errore se necessario. Mostrare le azioni di edit/delete nella tabella materiali solo ed esclusivamente per i materiali custom (`isExtra = true`).
2. Nei componenti modali condizionali, consentire esplicitamente il rendering di HTML (es. tramite un flag `asHtml`) quando è necessario inserire controlli interattivi all'interno dei messaggi, e leggere questi controlli prima del reset/cleanup del DOM del modale.
3. Eseguire in parallelo (`Promise.all`) gli aggiornamenti di Firestore su più documenti tecnici per abbattere i tempi di risposta rispetto a cicli asincroni sequenziali.
4. Sincronizzare la presenza degli utenti web utilizzando Firebase Realtime Database (RTDB) invece di affidarsi solo al timestamp di aggiornamento di Firestore (`updatedAt`), garantendo una visualizzazione accurata in tempo reale dell'utente attivo ("🟢 Online ora") o dell'ultimo accesso logico.

## Errore: Stato snapshot non persistente tra sessioni e non sincronizzato tra schede
**Causa:** `currentDate` in `state.js` era una variabile JS in-memory inizializzata sempre a `'live'`. Ad ogni reload o apertura di una nuova scheda/PWA, lo snapshot tornava a `'live'` indipendentemente da cosa l'utente aveva selezionato. Inoltre, le schede aperte simultaneamente erano totalmente ignare dei cambi di snapshot effettuati altrove.
**Regola:**
1. Qualsiasi preferenza UI che l'utente imposta esplicitamente (come la data di snapshot) va persistita in `localStorage` con try/catch. La variabile in memoria va inizializzata leggendo `localStorage` all'avvio del modulo.
2. Per sincronizzare stato tra schede dello stesso dominio, usare il listener `window.addEventListener('storage', ...)` che si attiva su qualsiasi scheda che NON ha fatto la modifica. Aggiornare il router (via hash change) o lo stato locale a seconda della vista corrente.
3. Gli href della sidebar devono sempre riflettere la data attiva corrente. Creare un helper dedicato (`updateSidebarHrefsAndCounts`) da invocare ad ogni cambio rotta nel router, incluse le viste non-appalto.

## Errore: Ramo snapshot di `loadAppalto` non filtrava tecnici senza materiali
**Causa:** Il ramo live di `loadAppalto` filtrava i tecnici che non avevano alcun materiale con valore non-vuoto (`Object.values(mats).some(...)`). Il ramo snapshot invece costruiva la lista partendo dai documenti snapshot, filtrando solo gli `isHiddenDoc`, ma non applicava il filtro sui materiali vuoti. Risultato: nel ramo snapshot apparivano colonne di tecnici con tutta la riga vuota, mentre il drawer (che usava `updateSidebarCountsForDate` che aveva il filtro corretto) mostrava il conteggio giusto.
**Regola:** Qualsiasi filtro applicato al ramo live di `loadAppalto` deve essere applicato identicamente al ramo snapshot. Quando si introduce un nuovo filtro (hidden, materiali vuoti, ecc.), verificare entrambi i rami. Il drawer e la tabella devono sempre mostrare lo stesso conteggio, altrimenti c'è un filtro mancante in uno dei due percorsi.

## Errore: Sfarfallio o cambio tab casuale (Ritorno automatico alla tab Tecnici/Admin)
**Causa:** L'attivazione di visualizzazioni amministrative (`#/admin/tecnici`, `#/admin/aree`, `#/admin/pfs`) registrava listener real-time (`onSnapshot` Firestore, `onValue` RTDB) i quali non venivano distrutti alla navigazione verso altre rotte (come le tabelle appalto). Se in background avveniva un aggiornamento (sync di un tecnico o cambiamento di presenza), il callback del listener orfano riscattava, invocando la funzione di rendering amministrativo che sostituiva l'HTML del `#content` (griglia materiali) con quello della tab precedente, lasciando intatto l'URL hash.
**Regola:** All'inizio del router centrale (`handleHashChange` in `app.js`), assicurarsi di distruggere sistematicamente tutti i listener real-time specifici delle viste precedenti (`stopLiveListener`, `stopTecniciListeners`, `stopBannedListeners`, `stopPfsListeners`, `stopAreeListener`, `stopPfsLookupListener`), garantendo che nessuna elaborazione asincrona in background possa forzare il rendering su container DOM condivisi.

## Errore: Spreco di Firebase Read Quota per listener multipli su devices_names
**Causa:** Ogni tab caricata registrava da 2 a 5 listener `onSnapshot` indipendenti sullo stesso documento `settings/devices_names` (in `app.js` per online count, in `pfsLookup.js` per preferiti, in `tecnici.js` per lista tecnici e banned, e in `aree.js` per la dashboard aree). Oltre ad essere disordinato, questo moltiplicava le letture Firebase a ogni singola modifica.
**Regola:** Implementare un pattern **Pub/Sub centrale** (in `state.js`). Registrare un unico listener globale reattivo al caricamento utente e consentire a ciascun modulo di iscriversi via chiave univoca (`subscribeToDevicesNames` / `unsubscribeFromDevicesNames`), azzerando le letture extra.

## Errore: Celle interattive e controlli in-app inaccessibili da tastiera e screen reader
**Causa:** L'editor inline si basava esclusivamente su eventi `dblclick` su desktop e `doubletap`/`longpress` su mobile. Le celle non avevano `tabindex`, non erano a fuoco, non rispondevano ai tasti e non fornivano informazioni semantiche ARIA.
**Regola:**
1. Qualsiasi elemento interattivo simulato (es. celle modificabili) deve includere `tabindex="0"`, `role="button"` e un'etichetta descrittiva `aria-label` aggiornata dinamicamente.
2. Assicurare l'attivazione dei tasti `Enter` e `Space` tramite listener `keydown` per consentire l'avvio della modifica e la sottomissione.
3. Usare la pseudo-classe CSS `:focus-visible` per visualizzare un indicatore ad alto contrasto senza intaccare l'estetica degli utenti mouse/touch.

## Errore: Dropdown Custom nascosto o tagliato da righe/sezioni della tabella
**Causa:** Il contenitore `.table-responsive` e le card delle sezioni avevano `overflow-x: auto` o `overflow: hidden`. Inserendo un dropdown grafico con `position: absolute`, questo veniva ritagliato o nascosto dietro le righe di tabella sottostanti o nelle sezioni successive (es. "Impianti da sospendere").
**Regola:** Quando si crea un menu a tendina o popup custom dentro una riga di tabella:
1. Impostare `overflow: visible` sul contenitore `.table-responsive` se le dimensioni della tabella lo permettono.
2. Usare la pseudo-classe `:has(.tech-dropdown-panel.active)` su `tr` e `.section-card` per elevare dinamicamente il `z-index` (es. `z-index: 999`) solo della riga che ha il dropdown aperto.
3. Assegnare un `z-index` elevato (es. `99999`) al pannello a discesa.

## Errore: Normalizzazione automatica erronea degli apparati PDF (CPE3 + SFP)
**Causa:** Nel modulo `pdfParser.js`, l'euristica di normalizzazione per gli apparati trasformava la stringa `cpe3` in `cpe3 + sfp` di default, aggiungendo componenti non presenti nel PDF reale dell'intervento.
**Regola:** Le euristiche di normalizzazione apparati devono rispecchiare fedelmente le specifiche dell'operatore OLO/Open Fiber. Non aggiungere mai componenti hardware accessori (come moduli SFP o bretelle) se non sono esplicitamente dichiarati nei campi del PDF.

## Errore: Scarsa leggibilità del testo orario in Excel generato
**Causa:** La colonna A dell'orario in `excelGenerator.js` applicava un colore di sfondo dinamico per la fascia oraria ma manteneva il font bianco (`#FFFFFF`). Su sfondi chiari o gialli (es. 11:00 / 14:00), il testo risultava illeggibile o quasi invisibile.
**Regola:** Per la formattazione dei fogli Excel esportati, assicurarsi che il testo sopra sfondi colorati dinamici sia sempre in **grassetto di colore nero** (`Calibri`, `bold: true`, `color: { argb: 'FF000000' }`), garantendo un alto contrasto visivo indipendentemente dal colore della fascia oraria.

## Errore: Rate-limit Geocodifica Nominatim API durante l'ottimizzazione rotte
**Causa:** Eseguire chiamate `fetch` in parallelo a Nominatim OpenStreetMap per geocodificare decine di indirizzi di appuntamenti contemporaneamente innescava l'errore `429 Too Many Requests` o il blocco IP da parte del servizio di geocodifica gratuito.
**Regola:** Quando si consuma l'API di geocodifica Nominatim in loop client-side, implementare:
1. Una pausa/delay asincrono (`await _sleep(1100)`) tra ciascuna richiesta per rispettare la policy di 1 richiesta al secondo.

## Errore: Blocco dell'assegnazione automatica guasti causa stringa provvisoria in tecnicoCentraleExcel
**Causa:** `autoAssignGuasti` controllava `!app.tecnicoCentraleExcel` prima di assegnare il tecnico del guasto (es. Cristian). Tuttavia, il parser inizializzava già `tecnicoCentraleExcel` con la sola località ed appalto (es. `"toh1 sertori"`), rendendo la stringa non-vuota e bloccando l'assegnazione del nome del tecnico.
**Regola:** In `autoAssignGuasti`, sovrascrivere direttamente il nome del tecnico in `app.tecnico` ed in `app.tecnicoCentraleExcel` senza condizionare l'operazione ad un controllo di stringa vuota, garantendo che il tecnico guasti impostato nel modal (es. Cristian per CD) venga sempre e solo lui assegnato ai guasti del suo cluster.

## Errore: Sovrascrittura delle assegnazioni guasti da parte dell'ottimizzatore rotte (`optimizeAssignments`)
**Causa:** `optimizeAssignments()` prelevava tutti gli interventi con `sezione === 'realizzare'` senza filtrare i guasti (`tipoIntervento === 'Guasto'` o `areaCd`). Di conseguenza, quando l'utente cliccava su `⚡ Ottimizza Assegnazioni`, l'algoritmo trattava i guasti come normali attivazioni e li ri-assegnava ai tecnici degli impianti (es. Mauro), sovrascrivendo l'assegnazione automatica effettuata al tecnico guasti (es. Cristian).
**Regola:** L'algoritmo `optimizeAssignments()` deve filtrare ed escludere tassativamente i guasti (`a.tipoIntervento !== 'Guasto' && !a.areaCd`), lasciandoli intatti ed affidati al tecnico guasti designato.

## Errore: Mancata applicazione dello sfondo grigio ai guasti nel file Excel
**Causa:** Nel loop della sezione `realizzare` in `excelGenerator.js`, la funzione `addDataRow` veniva invocata senza passare il flag `{ isGuasto: true }` per gli appuntamenti di tipo guasto che risiedono nella sezione `realizzare`.
**Regola:** Nell'esportatore Excel, valutare sempre `const isGuasto = item.tipoIntervento === 'Guasto' || Boolean(item.areaCd)` per ogni riga esportata (anche se fa parte della sezione `realizzare`), passando `{ isGuasto: true }` a `addDataRow` affinché applichi il riempimento grigio `#C0C0C0` su tutte le colonne.

## Errore: `pdfjs-dist` importato con `workerSrc` da `import.meta.url` fallisce quando richiamato via `require`/CJS in Node
**Causa:** Nei test di replica del parser eseguiti in Node (`test_parser.js`), l'import ESM di `js/pdfParser.js` combinato con `require('pdfjs-dist')` falliva con errore del fake worker (`Worker was not loaded`), perché il modulo usa `workerSrc = new URL(...).href` calcolato su `import.meta.url`, non risolvibile in un contesto CommonJS.
**Regola:** Per validare/duplicare la logica di parsing in script Node di test, importare direttamente il build legacy/CJS di pdfjs (`require('pdfjs-dist/build/pdf.js')` in v3) e replicare il flusso di estrazione + regex, senza importare il modulo ESM dell'app. I test funzionali (`replica_parser.js`, `sim_collect.js`) confermano il comportamento atteso senza toccare il bundler Vite.

## Errore: Client che non legge `comuniClusters`/`appalti` scritti su Firestore da altro browser
**Causa:** I dati comuni/appalti per tecnico erano salvati solo in `localStorage` per-browser; la scrittura su Firestore documentata nelle impostazioni portava a confusione sul perché un altro dispositivo non li vedesse.
**Regola:** Tenere distinto cosa è per-browser (configurazione manuale del singolo operatore, `localStorage`) da cosa è condiviso (`comuniClusters` su `settings/assegnazioni_web`). Prima di dichiarare un dato "online", verificare che il flusso read/write lo trasporti davvero (round-trip) e documentarlo.

## Errore: Assegnazione comuni ai tecnici guasti ignorava il cluster AB/CD
**Causa:** L'abilitazione del comune sui tecnici guasti avveniva a monte dell'estrazione dell'`areaCd`, per cui ogni guasto abilitava il comune su tutti i tecnici guasti (AB e CD insieme).
**Regola:** Quando un dominio logico (cluster AB/CD) è estratto dal documento sorgente (PDF), il filtro di destinazione (quale tecnico abilitare) deve dipendere da quel dominio. Verificare sempre la pipeline su dati reali (PDF di esempio) piuttosto che assumere il comportamento dell'euristica.

## Errore: `XME_TMPREPORT_*.pdf` scambiati per singoli Work Order
**Causa:** I file `XME_TMPREPORT_*.pdf` in `context_study/` contengono più Work Order (report multi-WR), mentre i file `*_INVIA_MAIL_WFM_*.PDF` contengono un singolo WR. Analizzare un report come se fosse un singolo WR porta a fraintendere il contenuto (attivazioni vs guasti).
**Regola:** Prima di giudicare un parser sui PDF di esempio, ispezionare la struttura del documento (numero di WR, tipo intervento) e separare i report multi-WR dai singoli WR.

