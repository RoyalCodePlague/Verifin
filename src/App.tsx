import { Suspense, lazy, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider } from "@/lib/store";
import { AuthProvider } from "@/lib/auth-context";
import { GuestRoute, OnboardingRoute, ProtectedRoute } from "@/components/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import { PWAInstallButton } from "./components/PWAInstallButton";
import { PageSkeleton } from "@/components/ui/page-skeleton";

const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Sales = lazy(() => import("./pages/Sales"));
const Expenses = lazy(() => import("./pages/Expenses"));
const Audits = lazy(() => import("./pages/Audits"));
const Reports = lazy(() => import("./pages/Reports"));
const Customers = lazy(() => import("./pages/Customers"));
const Invoices = lazy(() => import("./pages/Invoices"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const Staff = lazy(() => import("./pages/Staff"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Billing = lazy(() => import("./pages/Billing"));
const About = lazy(() => import("./pages/About"));
const Demo = lazy(() => import("./pages/Demo"));
const Login = lazy(() => import("./pages/Login"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const Terms = lazy(() => import("./pages/Terms"));
const Contact = lazy(() => import("./pages/Contact"));
const Privacy = lazy(() => import("./pages/Privacy"));
const HelpCenter = lazy(() => import("./pages/HelpCenter"));
const Careers = lazy(() => import("./pages/Careers"));
const ApiDocs = lazy(() => import("./pages/ApiDocs"));

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

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background p-4 lg:p-8">
      <div className="mx-auto w-full max-w-6xl">
        <PageSkeleton />
      </div>
    </div>
  );
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
            <Suspense fallback={<RouteFallback />}>
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
                <Route path="/invoices" element={<ProtectedRoute><AppRoute><Invoices /></AppRoute></ProtectedRoute>} />
                <Route path="/suppliers" element={<ProtectedRoute><AppRoute><Suppliers /></AppRoute></ProtectedRoute>} />
                <Route path="/staff" element={<ProtectedRoute><AppRoute><Staff /></AppRoute></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><AppRoute><SettingsPage /></AppRoute></ProtectedRoute>} />
                <Route path="/billing" element={<ProtectedRoute><AppRoute><Billing /></AppRoute></ProtectedRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </StoreProvider>
  </QueryClientProvider>
);

export default App;
