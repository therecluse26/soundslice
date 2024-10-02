import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { Footer } from "./Footer";

export function Applayout() {
  return (
    <div className="flex flex-col h-screen">
      {/* <div className="fixed top-0 left-0 right-0 z-10"> */}
      <Header />
      {/* </div> */}
      <main className="flex-grow overflow-auto mt-[header-height] mb-[footer-height]">
        <div className="flex justify-center w-full h-full">
          <Outlet />
        </div>
      </main>
      {/* <div className="fixed bottom-0 left-0 right-0 z-10"> */}
      <Footer />
      {/* </div> */}
    </div>
  );
}
