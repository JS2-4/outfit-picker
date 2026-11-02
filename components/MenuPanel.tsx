"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { SettingsModal } from "./SettingsModal"

const links = [
  { href: "/", label: "CLOTHING" },
  { href: "/outfits", label: "OUTFITS" },
  { href: "/profile", label: "PROFILE" },
]

function MenuPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // ESC closes whichever layer is actually open — settings first (since it
  // sits on top), then the slide-out menu itself. Lives here rather than in
  // SettingsModal because this component already owns both pieces of state.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      if (showSettings) {
        setShowSettings(false)
      } else if (isOpen) {
        setIsOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, showSettings])

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
        className="flex flex-col gap-1.5"
      >
        <span className="block h-px w-6 bg-black dark:bg-white" />
        <span className="block h-px w-6 bg-black dark:bg-white" />
      </button>

      <div
        aria-hidden={!isOpen}
        className={`fixed inset-0 z-50 ${isOpen ? "" : "pointer-events-none"}`}
      >
        <div
          className={`absolute inset-0 bg-black/20 transition-opacity duration-300 ease-out ${
            isOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setIsOpen(false)}
        />

        <div
          className={`absolute left-0 top-0 flex h-full w-64 flex-col bg-white transition-transform duration-300 ease-out will-change-transform dark:bg-neutral-900 ${
            isOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center border-b border-black/10 px-8 py-4 dark:border-white/10">
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close menu"
              className="text-2xl leading-none text-black dark:text-white"
            >
              ×
            </button>
          </div>

          <nav className="flex flex-col gap-4 px-8 py-8">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="text-sm tracking-widest text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex-1" />

          <div className="flex flex-col gap-4 border-t border-black/10 px-8 py-6 dark:border-white/10">
            <button
              onClick={() => {
                setIsOpen(false)
                setShowSettings(true)
              }}
              className="text-left text-sm tracking-widest text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
            >
              SETTINGS
            </button>
            <button
              onClick={() => {
                // Placeholder until auth (Phase G) exists — nothing to sign out of yet.
                setIsOpen(false)
              }}
              className="text-left text-sm tracking-widest text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
            >
              SIGN OUT
            </button>
          </div>
        </div>
      </div>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  )
}

export { MenuPanel }
export default MenuPanel