@echo off
:: Naviga nella cartella del progetto
cd /d "%~dp0"

echo.
echo ===========================================
echo   AVVIO ASSEGNAZIONI APPUNTAMENTI (Vite)
echo ===========================================
echo.

echo 1. Chiusura di eventuali server rimasti aperti sulla porta 9000...
FOR /F "tokens=5" %%a IN ('netstat -aon ^| find "9000" ^| find "LISTENING"') DO taskkill /F /PID %%a >nul 2>&1

echo 2. Avvio server locale Vite su porta 9000...
:: Avvia il server Vite in una nuova finestra
start "Assegnazioni_Appuntamenti_Server" cmd /k "title Server Assegnazioni Appuntamenti (Chiudi per spegnere) && npm run dev"

:: Aspetta che Vite sia pronto
timeout /t 3 /nobreak >nul

echo 3. Apertura del browser su http://localhost:9000...
:: Comando PowerShell per Brave o fallback su predefinito
powershell -Command "try { Start-Process brave 'http://localhost:9000' -ErrorAction Stop } catch { Start-Process 'http://localhost:9000' }"

echo.
echo Operazione completata.
timeout /t 3 >nul
exit
