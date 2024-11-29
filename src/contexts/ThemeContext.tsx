import { createContext, useEffect, useState } from "react"

type ThemeProviderProps = {
    children: React.ReactNode
    defaultTheme?: string
    storageKey?: string
}

export type ThemeProviderState = {
    theme: string
    setTheme: (theme: string) => void
}

const initialState = {
    theme: "system",
    setTheme: () => null,
}

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
    children,
    defaultTheme = "system",
    storageKey = "shadcn-ui-theme",
    ...props
}: ThemeProviderProps) {
    const [theme, setTheme] = useState(
        () => localStorage.getItem(storageKey) ?? defaultTheme
    )

    useEffect(() => {
        const root = window.document.documentElement
        root.classList.remove("light", "dark")
        root.classList.add("dark")
    }, [theme])

    return (
        <ThemeProviderContext.Provider {...props} value={{
            theme,
            setTheme: (theme: string) => {
                localStorage.setItem(storageKey, theme)
                setTheme(theme)
            },
        }}>
            {children}
        </ThemeProviderContext.Provider>
    )
}
