interface AppConfig {
    name: string,
    author: {
        name: string,
        url: string
    },
}

export const appConfig: AppConfig = {
    name: "Audio Trimmer",
    author: {
        name: "therecluse26",
        url: "https://github.com/therecluse26",
    }
}