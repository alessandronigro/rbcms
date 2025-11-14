import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

interface MenuItem {
  label: string;
  href?: string;
  subitems?: MenuItem[];
}

export default function MultiDropdown({
  label,
  items,
  open,
  onToggle,
}: {
  label: string;
  items: MenuItem[];
  open: boolean;
  onToggle: () => void;
}) {
  const [subOpen, setSubOpen] = useState<string | null>(null);
  const toggleSub = (lbl: string) => setSubOpen(subOpen === lbl ? null : lbl);

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 hover:text-blue-600"
      >
        {label}
        <ChevronDown size={14} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="absolute left-0 mt-2 bg-white border rounded-md shadow-md text-sm w-56 z-50"
          >
            {items.map((item) => (
              <li key={item.label} className="relative group">
                {item.subitems ? (
                  <>
                    <button
                      onClick={() => toggleSub(item.label)}
                      className="flex w-full justify-between items-center px-3 py-2 hover:bg-blue-50"
                    >
                      <span>{item.label}</span>
                      <ChevronRight size={14} />
                    </button>

                    <AnimatePresence>
                      {subOpen === item.label && (
                        <motion.ul
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute top-0 left-full ml-1 bg-white border rounded-md shadow-md text-sm w-52 z-50"
                        >
                          {item.subitems.map((sub) => (
                            <li key={sub.label}>
                              <a
                                href={sub.href}
                                className="block px-3 py-2 hover:bg-blue-50 hover:text-blue-600"
                              >
                                {sub.label}
                              </a>
                            </li>
                          ))}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </>
                ) : (
                  <a
                    href={item.href}
                    className="block px-3 py-2 hover:bg-blue-50 hover:text-blue-600"
                  >
                    {item.label}
                  </a>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
