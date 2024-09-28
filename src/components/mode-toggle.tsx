import { MoonIcon, SunIcon } from "@radix-ui/react-icons";

import { Button } from "@/components/ui/button";
const themes = {
  0: "light",
  1: "dark",
};

import { useTheme } from "@/hooks/useTheme";

export function ModeToggle() {
  const { setTheme } = useTheme();

  const toggleTheme = () => {
    const currentTheme = localStorage.getItem("theme");
    const nextThemeIdx = currentTheme === "light" ? 1 : 0;
    setTheme(themes[nextThemeIdx]);
    localStorage.setItem("theme", themes[nextThemeIdx]);
  };

  return (
    <Button variant="ghost" className="w-9 px-0" onClick={toggleTheme}>
      <SunIcon className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <MoonIcon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
