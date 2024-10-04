import { appConfig } from "@/config/app";

export function Footer() {
  return (
    <footer className="flex flex-col items-center justify-center min-h-[2.4rem]  md:flex-row">
      <p className="text-center text-md leading-loose text-muted-foreground md:text-left">
        Like this app? {""}
        <a
          href={appConfig.author.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          Buy me a coffee!
        </a>{" "}
        ☕
      </p>
    </footer>
  );
}
