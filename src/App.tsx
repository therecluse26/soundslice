import { ThemeProvider } from "./contexts/ThemeContext";
import { Header } from "./components/layouts/Header";
import { Footer } from "./components/layouts/Footer";
import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
    <ThemeProvider>
      <div className="flex flex-col h-screen">
        <Header />
        <main className="flex-grow overflow-auto mt-[header-height] mb-[footer-height]">
          <div className="flex justify-center w-full h-full">
            <Dashboard />
          </div>
        </main>
        <Footer />
      </div>
    </ThemeProvider>
  );
}
