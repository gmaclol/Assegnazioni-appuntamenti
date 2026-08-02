@echo off
cd /d "%~dp0"

echo.
echo ==============================================
echo    AGGIORNAMENTO AUTOMATICO VERSO GITHUB
echo ==============================================
echo.

echo 1. Costruzione dei file ottimizzati (Vite)...
call npm run build
echo.

echo 2. Sincronizzazione con GitHub...
:: Controlla se la cartella è già tracciata da Git, altrimenti la inizializza
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

:: Aggiunge tutte le modifiche e committa
git add .
git commit -m "Aggiornamento automatico Assegnazioni appuntamenti: %date% %time%"

:: Forziamo l'allineamento online verso la nuova repository main
echo - Caricamento online in corso... (potrebbe richiedere qualche secondo)
git push -f -u origin main

echo.
echo ==============================================
echo    SUCCESSO! Il tuo sito e' aggiornato online!
echo    Tempo 2 minuti e le modifiche saranno live.
echo ==============================================
echo.
pause >nul
exit
