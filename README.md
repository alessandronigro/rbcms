# 🧩 RBCMS – Modernizzazione della piattaforma RB CMS

**RBCMS** è la nuova versione moderna e modulare del sistema legacy *RB Web Automation*, riscritta interamente in **Node.js + React (Vite)**.  
Il progetto combina backend Express, frontend React con TailwindCSS, e integrazioni con **Supabase**, **MySQL**, **Stripe** e **Replicate** per funzionalità AI, crediti e contenuti multimediali.

---

## 🚀 Caratteristiche principali

- ⚙️ **Backend Node.js + Express** con architettura modulare e API REST
- 🧠 **Supabase** per autenticazione, database e gestione crediti utente
- 💾 **MySQL** come database relazionale per dati legacy e multi-tenant
- 💸 **Stripe** per gestione abbonamenti e crediti
- 🎧 **Replicate AI** per generazione di audio, immagini e contenuti dinamici
- 🖼️ **React + Vite + Tailwind** per un’interfaccia moderna e veloce
- 📄 **Puppeteer / TCPDF** per generazione di PDF dinamici e attestati
- 🔐 Gestione multi-database con connessioni dinamiche `getConnection(host, db)`
- 🌐 Supporto a ambienti multipli (dev, staging, production)

## Configurazione PEC

Il backend legge le credenziali PEC da `.env.*`; per inviare documenti tramite `invioMailPEC` bisogna impostare:

- `PEC_SMTP_USER` e `PEC_SMTP_PASSWORD`: username e password validi per `smtps.pec.aruba.it`
- `SENDPASSWORD` rimane un fallback per compatibilità, ma il login vero deve venir da `PEC_SMTP_*`

Se non sono settate, il server restituisce `Credenziali PEC mancanti`. Aggiorna i file `.env.development`/`.env.production` con le tue credenziali reali e tienile segrete.

---

📄 Licenza

Progetto proprietario © Alessandro Nigro
Tutti i diritti riservati. Non ridistribuire senza consenso.


👤 Autore

Alessandro Nigro
🌐 formazioneintermediari.com￼
📧 alessandro.nigro78@gmail.com
