#!/bin/bash

# ===============================================================
# Script per convertire ricorsivamente tutti i file .doc in .docx
# Se il file .docx esiste già, elimina solo il .doc originale.
# Richiede: LibreOffice (sudo apt install libreoffice -y)
# ===============================================================

# Directory di partenza (default: quella corrente)
DIR=${1:-.}

# Controlla che LibreOffice sia installato
if ! command -v libreoffice &> /dev/null; then
    echo "⚠️ LibreOffice non è installato. Installalo con:"
    echo "sudo apt install libreoffice -y"
    exit 1
fi

echo "🔍 Inizio conversione nella directory: $DIR"
echo "--------------------------------------------"

# Trova tutti i file .doc (esclude già quelli .docx)
find "$DIR" -type f -iname "*.doc" ! -iname "*.docx" | while read -r FILE; do
    OUTDIR=$(dirname "$FILE")
    BASENAME=$(basename "$FILE")
    DOCX_PATH="${FILE}x"  # esempio: file.doc → file.docx
    
    if [ -f "$DOCX_PATH" ]; then
        echo "⚠️ Esiste già: $DOCX_PATH → elimino solo il .doc"
        rm "$FILE"
    else
        echo "📝 Converto: $BASENAME"
        libreoffice --headless --convert-to docx "$FILE" --outdir "$OUTDIR" >/dev/null 2>&1
        
        if [ -f "$DOCX_PATH" ]; then
            echo "✅ Conversione completata: $DOCX_PATH"
            rm "$FILE"
        else
            echo "❌ Errore nella conversione di: $FILE"
        fi
    fi
done

echo "--------------------------------------------"
echo "🏁 Conversione completata!"
