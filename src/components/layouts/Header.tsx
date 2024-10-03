import { useState } from "react";
import { Logo } from "../logo";

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="supports-backdrop-blur:bg-background/60 sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur">
      <div className="container px-4 md:px-8 flex h-14 items-center justify-center">
        <div className="flex items-center space-x-2">
          <Logo />
        </div>
      </div>
    </header>
  );
}
