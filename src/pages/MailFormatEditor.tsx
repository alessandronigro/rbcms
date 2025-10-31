import { useEffect, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CKEditor } from "@ckeditor/ckeditor5-react";
import ClassicEditor from "@ckeditor/ckeditor5-build-classic";
/**
 * Fallback useToast hook used when "@/components/ui/use-toast" is not available.
 * Provides a minimal toast function that shows a temporary DOM message or alert for destructive variants.
 */
function useToast() {
    const toast = ({ title, description, variant }: { title: string; description?: string; variant?: string }) => {
        if (typeof window === "undefined") return;
        if (variant === "destructive") {
            // fallback to alert for destructive messages
            alert(`${title}${description ? ": " + description : ""}`);
            return;
        }

        // minimal non-blocking toast: temporary element in the top-right
        const el = document.createElement("div");
        el.textContent = `${title}${description ? " - " + description : ""}`;
        el.style.position = "fixed";
        el.style.top = "1rem";
        el.style.right = "1rem";
        el.style.background = "rgba(0,0,0,0.75)";
        el.style.color = "#fff";
        el.style.padding = "8px 12px";
        el.style.borderRadius = "6px";
        el.style.zIndex = "9999";
        el.style.fontSize = "14px";
        document.body.appendChild(el);
        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 3000);
    };

    return { toast };
}

export default function MailFormatEditor() {
    const [formats, setFormats] = useState<Record<string, string[]>>({});
    const [selected, setSelected] = useState("");
    const [html, setHtml] = useState("");
    const [loading, setLoading] = useState(false);
    const [newKey, setNewKey] = useState("");
    const [newCat, setNewCat] = useState("");
    const { toast } = useToast();

    // 📥 Carica elenco formati
    useEffect(() => {
        fetch(`${import.meta.env.VITE_BACKEND_URL}/api/mailformat/list`)
            .then(res => res.json())
            .then(data => {
                if (data.success) setFormats(data.data);
            })
            .catch(() =>
                toast({ title: "Errore", description: "Impossibile caricare i formati", variant: "destructive" })
            );
    }, []);
    // 📥 Carica elenco formati
    const loadFormats = async () => {
        try {
            const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/mailformat/list`);
            const data = await res.json();
            if (data.success) setFormats(data.data);
        } catch {
            toast({
                title: "Errore",
                description: "Impossibile caricare i formati",
                variant: "destructive",
            });
        }
    };
    // 📖 Carica contenuto quando cambia il formato selezionato
    useEffect(() => {
        if (!selected) return;
        setLoading(true);
        fetch(`${import.meta.env.VITE_BACKEND_URL}/api/mailformat/${selected}`)
            .then(res => res.text())
            .then(setHtml)
            .finally(() => setLoading(false));
    }, [selected]);


    const createTemplate = async () => {
        if (!newKey) return alert("Inserisci un nome per il template");
        try {
            const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/mailformat/new`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: newKey, category: newCat }),
            });
            const data = await res.json();
            if (data.success) {
                toast({ title: "Creato", description: "Nuovo template aggiunto ✅" });
                setNewKey("");
                setNewCat("");
                await loadFormats();
            } else {
                toast({ title: "Errore", description: data.error, variant: "destructive" });
            }
        } catch {
            toast({
                title: "Errore",
                description: "Creazione template non riuscita",
                variant: "destructive",
            });
        }
    };
    // 💾 Salva modifiche
    const handleSave = async () => {
        if (!selected) return alert("Seleziona un formato da modificare");
        setLoading(true);
        try {
            const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/mailformat/${selected}`, {
                method: "POST",
                headers: { "Content-Type": "text/html" },
                body: html,
            });
            const data = await res.json();
            if (data.success)
                toast({ title: "Salvato", description: "Formato aggiornato con successo" });
        } catch {
            toast({ title: "Errore", description: "Errore durante il salvataggio", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-5xl mx-auto bg-white rounded-xl shadow">
            <h1 className="text-2xl font-bold mb-4 text-gray-800">🧩 Editor Formati Email</h1>
            {/* ➕ Creazione nuovo template */}
            <div className="flex flex-wrap gap-2 mb-6">
                <input
                    type="text"
                    placeholder="Nome nuovo template..."
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className="border px-3 py-2 rounded w-full md:w-1/2"
                />
                <input
                    type="text"
                    placeholder="Categoria (opzionale)"
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    className="border px-3 py-2 rounded w-full md:w-1/4"
                />
                <Button onClick={createTemplate} className="bg-green-600 hover:bg-green-700 text-white">
                    <Plus className="mr-2" /> Crea Template
                </Button>
            </div>
            <label className="block mb-2 font-semibold">Seleziona formato:</label>
            <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="border border-gray-300 rounded w-full p-2 mb-4"
            >
                <option value="">-- Seleziona un formato --</option>
                {Object.entries(formats).map(([cat, items]) => (
                    <optgroup key={cat} label={cat}>
                        {items.map((key) => (
                            <option key={key} value={key}>{key}</option>
                        ))}
                    </optgroup>
                ))}
            </select>

            {loading && <p className="text-gray-500 mb-4">Caricamento...</p>}

            {selected && (
                <>
                    <CKEditor
                        editor={ClassicEditor as any}
                        data={html}
                        onChange={(_, editor) => setHtml(editor.getData())}
                    />
                    <div className="flex justify-end mt-4">
                        <Button onClick={handleSave} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
                            {loading ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />}
                            Salva formato
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}