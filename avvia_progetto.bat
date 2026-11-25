@echo off
:: Naviga nella cartella del progetto
cd /d "%~dp0"

echo.
echo ===========================================
echo   AVVIO ASSEGNAZIONI APPUNTAMENTI (Vite)
echo ===========================================
echo.

echo 1. Chiusura di eventuali server rimasti aperti...
FOR /F "tokens=5" %%a IN ('netstat -aon ^| findstr ":900" ^| find "LISTENING"') DO taskkill /F /PID %%a >nul 2>&1

echo 2. Avvio server locale Vite...
:: Vite sceglie la porta da solo: se la 9000 e' occupata (capita con le connessioni
:: appena chiuse) passa a 9001, 9002... Il browser viene aperto sulla porta che
:: risponde davvero, altrimenti si finirebbe su una pagina inesistente servita
:: dalla cache del service worker (sintomo: "le modifiche non arrivano").
start "Assegnazioni_Appuntamenti_Server" cmd /k "title Server Assegnazioni Appuntamenti (Chiudi per spegnere) && npm run dev"

:: Aspetta che Vite sia pronto
timeout /t 4 /nobreak >nul

echo 3. Apertura del browser sulla porta attiva...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apri_app.ps1"

echo.
echo Operazione completata.
timeout /t 3 >nul
exit
