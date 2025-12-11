# Integrare la route `weborders` da PHP

Il backend espone ora la route `POST /api/iscrizioni/weborders` (vedi `backend/routes/Iscrizioni.js:633-808`) che esegue l'intero flusso di iscrizione dei corsisti partendo da un ordine WooCommerce. Non è più necessario chiamare `IscriviWebnew` via SOAP: basta mandare una richiesta HTTP con gli stessi dati essenziali.

## Parametri principali

- **Body JSON**
  - `idordine` (obbligatorio): l'ID dell'ordine WooCommerce
  - `chkexist`: se `false` forza la ricreazione dell'utente (come faceva il `chkexist` della funzione SOAP)
  - `sendmail`: `true` se si vuole inviare la mail automatica, `false` per disabilitarla
  - `corsistaId` / `corsistaIds`: opzionali per iscrivere solo alcuni corsisti dell'ordine
- **Query string**
  - `db` (o `webdb` nel body): nome del database WordPress che contiene l'ordine (`newformazione`, `rbacademy`, `novastudia`, ecc.)

## Esempio di helper PHP

```php
function iscriviCorsistiWeborders(
    string $apiBase,
    int $orderId,
    string $webDb = "newformazione",
    bool $sendMail = true,
    bool $disableExistCheck = true
) {
    $payload = [
        "idordine" => $orderId,
        "chkexist" => $disableExistCheck ? false : true,
        "sendmail" => $sendMail,
    ];

    // Per compatibilità con la logica precedente, restituiamo il payload durante i test locali.
    if (defined("_LOCAL") && _LOCAL) {
        return $payload;
    }

    $url = rtrim($apiBase, "/") . "/api/iscrizioni/weborders?db=" . urlencode($webDb);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ["Content-Type: application/json"],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 60,
    ]);

    $response = curl_exec($ch);
    $error = curl_error($ch);
    $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false || $statusCode >= 400) {
        throw new \RuntimeException(
            "Errore weborders: {$statusCode} - " . ($response ?: $error)
        );
    }

    return json_decode($response, true);
}

// Uso tipico
$result = iscriviCorsistiWeborders(
    "https://api.formazioneintermediari.com",
    (int) $order->id,
    "newformazione",
    true,
    false
);
```

### Qualche nota

- La route aggiorna automaticamente lo stato dell'ordine (`order_status='completed'`) e imposta i corsisti.
- Se servono dati extra (es. `corsistaId`) basta aggiungerli al body, il controller li usa già.
- Per test locali puoi continuare ad appoggiarti a variabili come `$_LOCAL` o a `admin` config, adattando il valore di `$apiBase`.
