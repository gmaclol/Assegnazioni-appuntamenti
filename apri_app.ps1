# Apre l'app locale sulla porta che risponde davvero.
# Vite, se la 9000 è occupata, passa a 9001/9002...: aprire sempre la 9000 farebbe
# finire il browser su una pagina inesistente e il service worker servirebbe la
# vecchia copia in cache (sintomo: "le modifiche non arrivano").
param(
    [switch]$SoloUrl  # per i test: stampa l'URL senza aprire il browser
)

$ErrorActionPreference = 'SilentlyContinue'

$trovato = $null
foreach ($porta in 9000, 9001, 9002, 9003, 9004) {
    for ($tentativo = 0; $tentativo -lt 6; $tentativo++) {
        try {
            $risposta = Invoke-WebRequest -Uri ('http://localhost:' + $porta) -UseBasicParsing -TimeoutSec 2
            if ($risposta.StatusCode -eq 200) {
                $trovato = 'http://localhost:' + $porta
                break
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if ($trovato) { break }
}

if (-not $trovato) {
    Write-Host "Nessun server locale raggiungibile su 9000-9004."
    Write-Host "Guarda la finestra 'Server Assegnazioni Appuntamenti' per l'errore di Vite."
    exit 1
}

Write-Host ("Apro " + $trovato)
if ($SoloUrl) { exit 0 }

# Brave se c'è, altrimenti il browser predefinito
try {
    Start-Process brave $trovato -ErrorAction Stop
} catch {
    Start-Process $trovato
}
exit 0
