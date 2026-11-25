@echo off
cd /d "%~dp0"

echo.
echo ==============================================
echo    AGGIORNAMENTO AUTOMATICO VERSO GITHUB
echo ==============================================
echo.

echo 1. Costruzione dei file ottimizzati (Vite)...
:: La build usa una cartella temporanea dentro il progetto, cosi' non dipende
:: dai permessi della cartella temporanea di Windows (causa frequente di errori).
set "OLD_TEMP=%TEMP%"
set "OLD_TMP=%TMP%"
set "BUILD_TMP=%~dp0.build-tmp"
if not exist "%BUILD_TMP%" mkdir "%BUILD_TMP%"
set "TEMP=%BUILD_TMP%"
set "TMP=%BUILD_TMP%"

call npm run build
set "BUILD_FAILED="
if errorlevel 1 set "BUILD_FAILED=1"
if not exist "docs\index.html" set "BUILD_FAILED=1"

set "TEMP=%OLD_TEMP%"
set "TMP=%OLD_TMP%"
rd /s /q "%BUILD_TMP%" >nul 2>&1
if defined BUILD_FAILED goto buildfallita
echo    Build completata.
echo.

echo 2. Sincronizzazione con GitHub...
:: Controlla se la cartella e' gia' tracciata da Git, altrimenti la inizializza
if not exist .git (
    echo - Prima configurazione del progetto rilevata...
    git init
    git branch -M main
    git remote add origin https://github.com/gmaclol/Assegnazioni-appuntamenti.git

    :: Configurazione rapida per evitare blocchi al primo avvio
    git config core.autocrlf true
    git config user.email "gmaclol@github.local"
    git config user.name "Gimmy"
)

:: Aggiunge tutte le modifiche e committa (se non c'e' nulla da committare va avanti)
git add .
git commit -m "Aggiornamento automatico Assegnazioni appuntamenti: %date% %time%" >nul 2>&1

:: Forziamo l'allineamento online verso la nuova repository main
echo - Caricamento online in corso... (potrebbe richiedere qualche secondo)
git push -f -u origin main
if errorlevel 1 goto pushfallito

echo.
echo ==============================================
echo    SUCCESSO! Il tuo sito e' aggiornato online!
echo    Tempo 2 minuti e le modifiche saranno live.
echo ==============================================
echo.
pause >nul
exit

:buildfallita
echo.
echo ==============================================
echo    ERRORE: LA BUILD E' FALLITA
echo ==============================================
echo Non e' stato pubblicato NIENTE: il sito online
echo e' rimasto com'era prima.
echo.
echo Leggi il messaggio di errore qui sopra e riprova.
echo (Se la build non riesce a svuotare la cartella docs,
echo  chiudi le finestre o i programmi che la stanno usando.)
echo.
pause
exit /b 1

:pushfallito
echo.
echo ==============================================
echo    ERRORE: CARICAMENTO SU GITHUB NON RIUSCITO
echo ==============================================
echo La build e' a posto (cartella docs aggiornata),
echo ma il push non e' andato a buon fine: controlla
echo la connessione o le credenziali di GitHub.
echo.
pause
exit /b 1
