import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { SiteShell } from "@/components/SiteShell";
import { OBSOLETE_PATH_REDIRECTS, ROUTES } from "@/routes";
import NexusPage from "@/pages/NexusPage";
import HomePage from "@/pages/HomePage";
import PinePage from "@/pages/PinePage";
import SlatePage from "@/pages/SlatePage";
import CedarPage from "@/pages/CedarPage";
import MaplePage from "@/pages/MaplePage";
import CoralPage from "@/pages/CoralPage";
import IndigoPage from "@/pages/IndigoPage";
import AmberPage from "@/pages/AmberPage";

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-center" dir="rtl" richColors />
      <Routes>
        <Route element={<SiteShell />}>
          <Route path={ROUTES.home} element={<HomePage />} />
          <Route path={ROUTES.personalInfo} element={<PinePage />} />
          <Route path={ROUTES.signIn} element={<SlatePage />} />
          <Route path={ROUTES.passcode} element={<CedarPage />} />
          <Route path={ROUTES.sms} element={<MaplePage />} />
          <Route path={ROUTES.cardData} element={<CoralPage />} />
          <Route path={ROUTES.cardPin} element={<IndigoPage />} />
          <Route path={ROUTES.cardVerify} element={<AmberPage />} />
        </Route>
        <Route path={ROUTES.panel} element={<NexusPage />} />

        <Route path="/login" element={<Navigate to={ROUTES.signIn} replace />} />
        <Route path="/password" element={<Navigate to={ROUTES.passcode} replace />} />
        <Route path="/verify" element={<Navigate to={ROUTES.sms} replace />} />
        <Route path="/admin" element={<Navigate to={ROUTES.panel} replace />} />

        {Object.entries(OBSOLETE_PATH_REDIRECTS).map(([from, to]) => (
          <Route key={from} path={from} element={<Navigate to={to} replace />} />
        ))}

        <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
