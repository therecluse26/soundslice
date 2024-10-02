import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Logo } from "../logo";

export function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return (
    <header className="supports-backdrop-blur:bg-background/60 sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur">
      <div className="container px-4 md:px-8 flex h-14 items-center justify-center">
        <div className="flex">
          <NavLink to="/" className="flex items-center space-x-2">
            <Logo />
          </NavLink>
        </div>
      </div>
    </header>
  );
}
