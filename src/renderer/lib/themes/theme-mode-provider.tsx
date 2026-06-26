import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

type ThemeValue = string | undefined
type SetThemeValue = ThemeValue | ((theme: ThemeValue) => ThemeValue)

interface ThemeProviderProps {
  children: ReactNode
  attribute?: "class" | `data-${string}` | Array<"class" | `data-${string}`>
  defaultTheme?: string
  enableSystem?: boolean
  enableColorScheme?: boolean
  themes?: string[]
  storageKey?: string
  forcedTheme?: string | null
  value?: Record<string, string>
}

interface ThemeContextValue {
  theme: ThemeValue
  setTheme: (theme: SetThemeValue) => void
  forcedTheme?: string | null
  resolvedTheme: string | undefined
  themes: string[]
  systemTheme: "light" | "dark" | undefined
}

const DEFAULT_THEMES = ["light", "dark"]
const SYSTEM_QUERY = "(prefers-color-scheme: dark)"

const ThemeContext = createContext<ThemeContextValue>({
  theme: undefined,
  setTheme: () => {},
  resolvedTheme: undefined,
  themes: DEFAULT_THEMES,
  systemTheme: undefined,
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

export function ThemeProvider({
  children,
  attribute = "data-theme",
  defaultTheme,
  enableSystem = true,
  enableColorScheme = true,
  themes = DEFAULT_THEMES,
  storageKey = "theme",
  forcedTheme = null,
  value,
}: ThemeProviderProps) {
  const fallbackTheme = defaultTheme ?? (enableSystem ? "system" : "light")
  const [theme, setThemeState] = useState<ThemeValue>(
    () => readStoredTheme(storageKey) ?? fallbackTheme,
  )
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
    getSystemTheme(),
  )

  const resolvedTheme =
    (forcedTheme ?? theme) === "system" && enableSystem
      ? systemTheme
      : (forcedTheme ?? theme)

  const setTheme = useCallback(
    (nextTheme: SetThemeValue) => {
      setThemeState((currentTheme) => {
        const resolvedNext =
          typeof nextTheme === "function" ? nextTheme(currentTheme) : nextTheme

        try {
          if (resolvedNext) {
            window.localStorage.setItem(storageKey, resolvedNext)
          } else {
            window.localStorage.removeItem(storageKey)
          }
        } catch {
          // Keep in-memory theme state even if browser storage is unavailable.
        }

        return resolvedNext
      })
    },
    [storageKey],
  )

  useEffect(() => {
    const media = window.matchMedia(SYSTEM_QUERY)
    const updateSystemTheme = () => setSystemTheme(getSystemTheme(media))

    updateSystemTheme()
    media.addEventListener("change", updateSystemTheme)
    return () => media.removeEventListener("change", updateSystemTheme)
  }, [])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return
      setThemeState(event.newValue ?? fallbackTheme)
    }

    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [fallbackTheme, storageKey])

  useEffect(() => {
    applyTheme({
      attribute,
      enableColorScheme,
      resolvedTheme,
      themes,
      value,
    })
  }, [attribute, enableColorScheme, resolvedTheme, themes, value])

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      forcedTheme,
      resolvedTheme,
      themes: enableSystem ? [...themes, "system"] : themes,
      systemTheme: enableSystem ? systemTheme : undefined,
    }),
    [
      enableSystem,
      forcedTheme,
      resolvedTheme,
      setTheme,
      systemTheme,
      theme,
      themes,
    ],
  )

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  )
}

function readStoredTheme(storageKey: string): string | undefined {
  if (typeof window === "undefined") return undefined

  try {
    return window.localStorage.getItem(storageKey) ?? undefined
  } catch {
    return undefined
  }
}

function getSystemTheme(media?: MediaQueryList): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light"

  const query = media ?? window.matchMedia(SYSTEM_QUERY)
  return query.matches ? "dark" : "light"
}

function applyTheme({
  attribute,
  enableColorScheme,
  resolvedTheme,
  themes,
  value,
}: {
  attribute: ThemeProviderProps["attribute"]
  enableColorScheme: boolean
  resolvedTheme: string | undefined
  themes: string[]
  value?: Record<string, string>
}): void {
  if (typeof document === "undefined") return
  if (!resolvedTheme) return

  const attributes = Array.isArray(attribute)
    ? attribute
    : [attribute ?? "data-theme"]
  const classValues = themes.map((theme) => value?.[theme] ?? theme)
  const renderedTheme = value?.[resolvedTheme] ?? resolvedTheme

  for (const item of attributes) {
    if (item === "class") {
      document.documentElement.classList.remove(...classValues)
      document.documentElement.classList.add(renderedTheme)
    } else if (item?.startsWith("data-")) {
      document.documentElement.setAttribute(item, renderedTheme)
    }
  }

  if (
    enableColorScheme &&
    (resolvedTheme === "light" || resolvedTheme === "dark")
  ) {
    document.documentElement.style.colorScheme = resolvedTheme
  }
}
