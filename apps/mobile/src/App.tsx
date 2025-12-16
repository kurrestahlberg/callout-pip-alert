import { useEffect, useState } from "react";
import { useAuth } from "./lib/auth";
import { setTokenGetter } from "./lib/api";
import { NavigationProvider, useNavigation, Page } from "./lib/navigation";
import { AudioProvider } from "./hooks/useAudio";
import { DemoModeProvider, useDemoMode } from "./hooks/useDemoMode";
import Layout from "./components/Layout";
import BootScreen from "./components/BootScreen";
import Toast from "./components/Toast";
import LoginPage from "./pages/LoginPage";
import IncidentsPage from "./pages/IncidentsPage";
import IncidentDetailPage from "./pages/IncidentDetailPage";
import SchedulePage from "./pages/SchedulePage";
import TeamPage from "./pages/TeamPage";
import SettingsPage from "./pages/SettingsPage";

function PageContainer({ isVisible, children }: { page: Page; isVisible: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`absolute inset-0 ${isVisible ? "z-10" : "z-0 pointer-events-none"}`}
      style={{
        visibility: isVisible ? "visible" : "hidden",
        opacity: isVisible ? 1 : 0,
      }}
    >
      {children}
    </div>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const { state, navigate } = useNavigation();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated && state.currentPage !== "login" && state.currentPage !== "settings") {
      navigate("login");
    }
  }, [isLoading, isAuthenticated, state.currentPage, navigate]);

  // Redirect to incidents after login
  useEffect(() => {
    if (isAuthenticated && state.currentPage === "login") {
      navigate("incidents");
    }
  }, [isAuthenticated, state.currentPage, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-900">
        <div className="text-amber-500 font-mono text-glow">{">"} AUTHENTICATING...</div>
      </div>
    );
  }

  const showLayout = state.currentPage !== "login";
  const mainPages: Page[] = ["incidents", "schedule", "team", "settings"];

  return (
    <div className="h-screen bg-zinc-900 relative overflow-hidden">
      {/* Login page - no layout */}
      <PageContainer page="login" isVisible={state.currentPage === "login"}>
        <LoginPage />
      </PageContainer>

      {/* Main app with layout */}
      {showLayout && (
        <Layout>
          <div className="relative h-full">
            {/* Tab pages */}
            {mainPages.map((page) => (
              <PageContainer key={page} page={page} isVisible={state.currentPage === page}>
                {page === "incidents" && <IncidentsPage />}
                {page === "schedule" && <SchedulePage />}
                {page === "team" && <TeamPage />}
                {page === "settings" && <SettingsPage />}
              </PageContainer>
            ))}

            {/* Incident detail overlay */}
            <PageContainer page="incident-detail" isVisible={state.currentPage === "incident-detail"}>
              <IncidentDetailPage incidentId={state.incidentId} />
            </PageContainer>
          </div>
        </Layout>
      )}
    </div>
  );
}

// Toast container that uses demo mode context
function ToastContainer() {
  const { toasts, dismissToast } = useDemoMode();
  return <Toast toasts={toasts} onDismiss={dismissToast} />;
}

function App() {
  const { getToken } = useAuth();
  const [bootComplete, setBootComplete] = useState(false);

  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);

  return (
    <AudioProvider>
      <DemoModeProvider>
        {!bootComplete ? (
          <BootScreen onComplete={() => setBootComplete(true)} />
        ) : (
          <NavigationProvider>
            <AppContent />
            <ToastContainer />
          </NavigationProvider>
        )}
      </DemoModeProvider>
    </AudioProvider>
  );
}

export default App;
