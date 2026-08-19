import { Logo } from "../logo";
import { ViewToggle } from "../custom/ViewToggle";

export function Header() {
  return (
    <header className="supports-backdrop-blur:bg-background/60 sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur">
      <div className="container relative px-4 md:px-8 flex h-14 items-center justify-center">
        <div className="flex items-center space-x-2">
          <Logo />
        </div>

        {/*
          Absolutely positioned, so adding the toggle does not move the logo.
          The logo stays exactly where it was before this control existed.

          ModeToggle is deliberately not here. The theme is forced to dark in
          ThemeContext, so that control would do nothing. See the resolution on
          ticket 012.
        */}
        <div className="absolute right-4 md:right-8 flex items-center gap-2">
          <ViewToggle />
        </div>
      </div>
    </header>
  );
}
