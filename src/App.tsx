import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider } from "@/lib/store";
import { AuthProvider } from "@/lib/auth-context";
import { GuestRoute, OnboardingRoute, ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Sales from "./pages/Sales";
import Expenses from "./pages/Expenses";
import Audits from "./pages/Audits";
import Reports from "./pages/Reports";
import Customers from "./pages/Customers";
import Staff from "./pages/Staff";
import Suppliers from "./pages/Suppliers";
import SettingsPage from "./pages/Settings";
import Onboarding from "./pages/Onboarding";
import Pricing from "./pages/Pricing";
import Billing from "./pages/Billing";
import About from "./pages/About";
import Demo from "./pages/Demo";
import Login from "./pages/Login";
import VerifyEmail from "./pages/VerifyEmail";
import Terms from "./pages/Terms";
import Contact from "./pages/Contact";
import Privacy from "./pages/Privacy";
import HelpCenter from "./pages/HelpCenter";
import Careers from "./pages/Careers";
import ApiDocs from "./pages/ApiDocs";
import AppLayout from "./components/layout/AppLayout";
import { PWAInstallButton } from "./components/PWAInstallButton";

const queryClient = new QueryClient();

const AppRoute = ({ children }: { children: React.ReactNode }) => (
  <AppLayout>{children}</AppLayout>
);

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <StoreProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <PWAInstallButton />
          <BrowserRouter>
            <ScrollToTop />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/onboarding" element={<OnboardingRoute><Onboarding /></OnboardingRoute>} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/about" element={<About />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/help" element={<HelpCenter />} />
              <Route path="/careers" element={<Careers />} />
              <Route path="/api" element={<ApiDocs />} />
              <Route path="/dashboard" element={<ProtectedRoute><AppRoute><Dashboard /></AppRoute></ProtectedRoute>} />
              <Route path="/inventory" element={<ProtectedRoute><AppRoute><Inventory /></AppRoute></ProtectedRoute>} />
              <Route path="/sales" element={<ProtectedRoute><AppRoute><Sales /></AppRoute></ProtectedRoute>} />
              <Route path="/expenses" element={<ProtectedRoute><AppRoute><Expenses /></AppRoute></ProtectedRoute>} />
              <Route path="/audits" element={<ProtectedRoute><AppRoute><Audits /></AppRoute></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><AppRoute><Reports /></AppRoute></ProtectedRoute>} />
              <Route path="/customers" element={<ProtectedRoute><AppRoute><Customers /></AppRoute></ProtectedRoute>} />
              <Route path="/suppliers" element={<ProtectedRoute><AppRoute><Suppliers /></AppRoute></ProtectedRoute>} />
              <Route path="/staff" element={<ProtectedRoute><AppRoute><Staff /></AppRoute></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><AppRoute><SettingsPage /></AppRoute></ProtectedRoute>} />
              <Route path="/billing" element={<ProtectedRoute><AppRoute><Billing /></AppRoute></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </StoreProvider>
  </QueryClientProvider>
);

export default App;
