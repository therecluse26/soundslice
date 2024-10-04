import { appConfig } from "@/config/app";
import { Icons } from "./icons";

export function Logo() {
  return (
    <>
      {/* <Icons.logo className="h-6 w-6" /> */}
      <svg width="100%" height="35">
        <image href="soundslice-logo-white.svg" width="100%" height="35" />
      </svg>
    </>
  );
}
