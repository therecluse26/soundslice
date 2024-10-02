import { appConfig } from "@/config/app";

export function Footer() {
  return (
    <footer className="flex flex-col items-center justify-center min-h-[2.4rem]  md:flex-row">
      <p className="text-center text-xs leading-loose text-muted-foreground md:text-left">
        Built by{" "}
        <a
          href={appConfig.author.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          {appConfig.author.name}
        </a>
        .
      </p>
    </footer>
  );
}
