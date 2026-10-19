import { useEffect } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ensureSeeded, requestPersistentStorage } from "./db/repo";
import { ToastProvider } from "./ui";
import Home from "./screens/Home";
import QuickAdd from "./screens/QuickAdd";
import More from "./screens/More";
import Systems from "./screens/Systems";
import { PartEdit, PartsList } from "./screens/Parts";
import { BinDetail, BinEdit, BinsList, NeedsBin, Staged } from "./screens/Bins";
import { SyncProvider } from "./sync/SyncProvider";
import SyncBar from "./sync/SyncBar";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/add", label: "Quick add" },
  { to: "/parts", label: "Parts" },
  { to: "/bins", label: "Bins" },
  { to: "/more", label: "Sync" },
];

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  useEffect(() => {
    void ensureSeeded();
    void requestPersistentStorage();
  }, []);

  return (
    <BrowserRouter>
      <ToastProvider>
        <SyncProvider>
          <ScrollToTop />
          <main className="app">
            <SyncBar />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/add" element={<QuickAdd />} />
              <Route path="/parts" element={<PartsList />} />
              <Route path="/parts/:id" element={<PartEdit />} />
              <Route path="/bins" element={<BinsList />} />
              <Route path="/bins/new" element={<BinEdit />} />
              <Route path="/bins/:id/edit" element={<BinEdit />} />
              <Route path="/b/:code" element={<BinDetail />} />
              <Route path="/queue/needs-bin" element={<NeedsBin />} />
              <Route path="/queue/staged" element={<Staged />} />
              <Route path="/more" element={<More />} />
              <Route path="/systems" element={<Systems />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </main>
          <nav className="tabbar" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "on" : "")}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </SyncProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
