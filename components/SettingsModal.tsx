"use client"

import { useTheme } from "@/contexts/ThemeContext"
import { FONT_OPTIONS, useFont } from "@/contexts/FontContext"

function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const { darkMode, toggleDarkMode } = useTheme()
  const { font, setFont } = useFont()

  return (
    <div
      aria-hidden={!isOpen}
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/20 transition-opacity duration-200 ${
        isOpen ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex w-[360px] flex-col gap-6 bg-white p-8 shadow-lg transition-all duration-200 ease-out dark:bg-neutral-900 ${
          isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-widest text-black dark:text-white">
            SETTINGS
          </h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="text-2xl leading-none text-black dark:text-white"
          >
            ×
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm tracking-widest text-black/70 dark:text-white/70">
            DARK MODE
          </span>
          <button
            role="switch"
            aria-checked={darkMode}
            onClick={toggleDarkMode}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
              darkMode ? "bg-black dark:bg-white" : "bg-neutral-300 dark:bg-neutral-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                darkMode ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Stacked rather than label-left/control-right like DARK MODE above.
            Measured at the modal's 360px: four options leave the pill 234px
            wide against 294px of usable width, which fits — but only by
            wrapping onto a second line inside its own border, so the pill
            reads as broken next to a single-line label. Putting the label on
            its own line gives the group the full width, and it stays on one
            line at 274px. Adding a fifth face will need this revisited. */}
        <div className="flex flex-col items-start gap-3">
          <span className="text-sm tracking-widest text-black/70 dark:text-white/70">
            FONT
          </span>

          {/* Each option's label is set in its own typeface, so the control
              doubles as the specimen — you can see the difference between them
              before committing to one, instead of switching and judging
              afterwards. */}
          <div
            role="radiogroup"
            aria-label="Font"
            className="flex items-center gap-1 rounded-full border border-black/10 p-1 dark:border-white/10"
          >
            {FONT_OPTIONS.map((option) => {
              const active = font === option.value
              return (
                <button
                  key={option.value}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setFont(option.value)}
                  style={{ fontFamily: option.preview }}
                  className={`rounded-full px-2.5 py-1 text-[10px] tracking-widest transition-colors duration-200 ${
                    active
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export { SettingsModal }
export default SettingsModal