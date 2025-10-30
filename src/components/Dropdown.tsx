import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

export default function Dropdown({
  label,
  items,
  open,
  onToggle,
}: {
  label: string;
  items: { label: string; href: string }[];
  open: boolean;
  onToggle: () => void;
}) {
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
            className="absolute left-0 mt-2 bg-white border rounded-md shadow-md text-sm w-48 z-50"
          >
            {items.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="block px-3 py-2 hover:bg-blue-50 hover:text-blue-600"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
