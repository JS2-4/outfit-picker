"use client"

import { createContext, useContext, useEffect, useState } from "react"

/**
 * Which typeface the app renders in. Deliberately built the same shape as
 * ThemeContext next door — localStorage for persistence, an attribute on
 * <html> as the single hook the stylesheet reads — so the two settings behave
 * identically and there's only one pattern to understand.
 *
 * ThemeContext toggles a CLASS (.dark) because that's what Tailwind's dark
 * variant needs. This one sets a data-attribute instead: font isn't a boolean,
 * and three mutually exclusive classes would need manual removal of whichever
 * one was there before. Setting an attribute overwrites the previous value for
 * free.
 *
 * `preview` is the raw CSS font-family for each option, so the settings modal
 * can render each choice's own label IN that face — you see what you're
 * picking before you commit to it, rather than switching and judging after.
 */
const FONT_OPTIONS = [
  {
    value: "SYSTEM",
    label: "ARIAL",
    preview: "Arial, Helvetica, sans-serif",
  },
  {
    value: "OUTFIT",
    label: "OUTFIT",
    preview: "var(--font-outfit), Arial, Helvetica, sans-serif",
  },
  {
    value: "JAKARTA",
    label: "JAKARTA",
    preview: "var(--font-jakarta), Arial, Helvetica, sans-serif",
  },
  {
    value: "VARELA",
    label: "VARELA",
    preview: "var(--font-varela), Arial, Helvetica, sans-serif",
  },
] as const

type FontChoice = (typeof FONT_OPTIONS)[number]["value"]

type FontContextValue = {
  font: FontChoice
  setFont: (font: FontChoice) => void
}

const FontContext = createContext<FontContextValue | undefined>(undefined)

// Guards the value coming back out of localStorage. That string is whatever
// was last written under this key — including a value from an older build
// whose option has since been renamed or dropped — so it can't be trusted as
// a FontChoice without checking it against the current list.
function isFontChoice(value: string | null): value is FontChoice {
  return FONT_OPTIONS.some((option) => option.value === value)
}

function FontProvider({ children }: { children: React.ReactNode }) {
  // Starts on SYSTEM to match what the server rendered. The real stored value
  // is read in the effect below, after hydration — reading localStorage during
  // render would produce different markup on the server and the client. The
  // blocking script in app/layout.tsx is what stops that costing a visible
  // flash of the wrong face: it sets data-font before first paint, so this
  // effect is only ever catching React's state up to what the DOM already
  // shows.
  const [font, setFontState] = useState<FontChoice>("SYSTEM")

  useEffect(() => {
    try {
      const stored = localStorage.getItem("font")
      if (isFontChoice(stored)) setFontState(stored)
    } catch {
      // Private browsing and blocked-storage modes throw on access rather
      // than returning null. The default face is a fine outcome there.
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute("data-font", font)
  }, [font])

  function setFont(next: FontChoice) {
    try {
      localStorage.setItem("font", next)
    } catch {
      // Same as above — the choice still applies for this session, it just
      // won't survive a reload.
    }
    setFontState(next)
  }

  return <FontContext.Provider value={{ font, setFont }}>{children}</FontContext.Provider>
}

function useFont() {
  const context = useContext(FontContext)
  if (!context) {
    throw new Error("useFont must be used within a FontProvider")
  }
  return context
}

export { FontProvider, useFont, FONT_OPTIONS }
export type { FontChoice }
