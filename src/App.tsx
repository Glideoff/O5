import { useEffect, useState } from "react";
import {
  HashRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@tauri-apps/api/core";
import { BootSequence } from "./components/BootSequence";
import { Layout } from "./components/Layout";
import { SettingsApplicator } from "./components/SettingsApplicator";
import { WarningScreen } from "./components/institutional/WarningScreen";
import { Comms } from "./pages/Comms";
import { Council } from "./pages/Council";
import { Dashboard } from "./pages/Dashboard";
import { Incidents } from "./pages/Incidents";
import { Personnel } from "./pages/Personnel";
import { Registry } from "./pages/Registry";
import { Settings } from "./pages/Settings";
import { MySites } from "./pages/MySites";
import { SiteMap } from "./pages/SiteMap";
import { Terminal } from "./pages/Terminal";
import { useCommsStore } from "./stores/commsStore";
import { useIncidentStore } from "./stores/incidentStore";
import {
  pathToPageLabel,
  useInstitutionalStore,
} from "./stores/institutionalStore";
import { usePlayerSitesStore } from "./stores/playerSitesStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUpdateStore } from "./stores/updateStore";

function NavigationBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const setNavigator = useIncidentStore((s) => s.setNavigator);
  const loadIncidentsFromDb = useIncidentStore((s) => s.loadIncidentsFromDb);
  const loadPlayerSites = usePlayerSitesStore((s) => s.load);
  const startIncidentTimer = useIncidentStore((s) => s.startIncidentTimer);
  const stopIncidentTimer = useIncidentStore((s) => s.stopIncidentTimer);
  const networkMode = useSettingsStore((s) => s.network_mode);
  const wsPort = useSettingsStore((s) => s.ws_port);
  const wireListeners = useCommsStore((s) => s.wireListeners);
  const startServer = useCommsStore((s) => s.startServer);
  const refreshFingerprint = useCommsStore((s) => s.refreshFingerprint);
  const initVersion = useUpdateStore((s) => s.initVersion);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const logAccess = useInstitutionalStore((s) => s.logAccess);
  const setIpSuffix = useInstitutionalStore((s) => s.setIpSuffix);
  const sessionExpired = useInstitutionalStore((s) => s.sessionExpired);

  useEffect(() => {
    setNavigator((path) => navigate(path));
  }, [navigate, setNavigator]);

  useEffect(() => {
    void initVersion();
  }, [initVersion]);

  useEffect(() => {
    const run = () => void checkForUpdates({ silent: true, autoInstall: false });
    const t0 = window.setTimeout(run, 4000);
    const interval = window.setInterval(run, 4 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(interval);
    };
  }, [checkForUpdates]);

  useEffect(() => {
    void loadIncidentsFromDb();
    void loadPlayerSites();
  }, [loadIncidentsFromDb, loadPlayerSites]);

  useEffect(() => {
    if (sessionExpired) {
      stopIncidentTimer();
      return;
    }
    startIncidentTimer();
    return () => stopIncidentTimer();
  }, [startIncidentTimer, stopIncidentTimer, sessionExpired]);

  useEffect(() => {
    void wireListeners();
    void refreshFingerprint();
  }, [wireListeners, refreshFingerprint]);

  useEffect(() => {
    if (networkMode === "server") {
      void startServer(wsPort);
    }
  }, [networkMode, wsPort, startServer]);

  useEffect(() => {
    if (isTauri()) {
      void invoke<string>("get_session_ip_suffix")
        .then(setIpSuffix)
        .catch(() => setIpSuffix("███"));
    }
  }, [setIpSuffix]);

  useEffect(() => {
    const label = pathToPageLabel(location.pathname || "/");
    logAccess(`Navigation : ${label}`);
  }, [location.pathname, logAccess]);

  return null;
}

export default function App() {
  const initSession = useInstitutionalStore((s) => s.initSession);

  const [warningAck, setWarningAck] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.sessionStorage.getItem("overseer:warning-ack") === "1";
  });

  const [bootDone, setBootDone] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.sessionStorage.getItem("overseer:boot-done") === "1";
  });

  // Réouverture avec avertissement déjà validé : initSession n’est pas rappelé par WarningScreen.
  useEffect(() => {
    if (warningAck) {
      initSession();
    }
  }, [warningAck, initSession]);

  const handleWarningAck = () => {
    window.sessionStorage.setItem("overseer:warning-ack", "1");
    initSession();
    setWarningAck(true);
  };

  return (
    <>
      <SettingsApplicator />
      {!warningAck && <WarningScreen onAck={handleWarningAck} />}
      {warningAck && !bootDone && (
        <BootSequence
          onDone={() => {
            window.sessionStorage.setItem("overseer:boot-done", "1");
            setBootDone(true);
          }}
        />
      )}
      {warningAck && bootDone && (
        <HashRouter>
          <NavigationBridge />
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="registry" element={<Registry />} />
              <Route path="council" element={<Council />} />
              <Route path="sites" element={<MySites />} />
              <Route path="sitemap" element={<SiteMap />} />
              <Route path="comms" element={<Comms />} />
              <Route path="personnel" element={<Personnel />} />
              <Route path="terminal" element={<Terminal />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </HashRouter>
      )}
    </>
  );
}
