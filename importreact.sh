#!/bin/bash
echo "🔧 Correzione import React e hook mancanti..."

find ./src -type f -name "*.tsx" | while read file; do
  if ! grep -q "from \"react\"" "$file"; then
    sed -i '1i import React, { useState, useEffect, useMemo, useContext, createContext } from "react";' "$file"
    echo "✅ Aggiunto import React in: $file"
  fi
done

echo "✨ Correzione completata!"
