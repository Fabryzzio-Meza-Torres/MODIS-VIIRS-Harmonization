import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'es'
const KEY = 'fuegotrazo:lang'
// NASA Space Apps: "All content must be in English" (github.com/nasa/spaceapps/discussions/2298), so English is the default.
const DEFAULT: Lang = 'en'
const TITLE: Record<Lang, string> = {
  en: 'FuegoTrazo — Harmonized MODIS·VIIRS thermal activity in Peru',
  es: 'FuegoTrazo — Actividad térmica MODIS·VIIRS armonizada en el Perú',
}

// The language of the render in progress. LangProvider sets it before any descendant renders, so plain helper
// functions (formatters, CSV builders, constants-as-functions) can call t() without being hooks.
let current: Lang = DEFAULT

/** Inline translation: t('texto en español', 'English text'). */
export const t = (es: string, en: string): string => (current === 'es' ? es : en)
export const getLang = (): Lang => current
export const locale = () => (current === 'es' ? 'es-PE' : 'en-US')

function initial(): Lang {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '').get('lang')
  if (q === 'en' || q === 'es') return q
  try { const s = localStorage.getItem(KEY); if (s === 'en' || s === 'es') return s } catch { /* storage blocked */ }
  return DEFAULT
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: DEFAULT, setLang: () => {} })
export const useLang = () => useContext(Ctx)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initial)
  current = lang
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = TITLE[lang]
    try { localStorage.setItem(KEY, lang) } catch { /* storage blocked */ }
  }, [lang])
  // keyed: switching language remounts the tree, so every plain t() call re-evaluates (data caches are module-level)
  return <Ctx.Provider value={{ lang, setLang }}><Fragment key={lang}>{children}</Fragment></Ctx.Provider>
}
