import { useState, useEffect, useRef } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Package, ShoppingCart, Receipt, ClipboardCheck,
  BarChart3, Users, UserCog, Settings, Menu, X, LogOut,
  CheckCircle, Moon, Sun, Clock, Truck,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken, pushOfflineActions } from "@/lib/api";
import {
  clearOfflineQueue,
  getOfflineQueue,
  hasAuthenticatedOfflineSession,
  markOfflineSession,
  setupOfflineSync,
} from "@/lib/offlineQueue";
import { NotificationCenter } from "@/components/NotificationCenter";
import { toast } from "sonner";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/inventory", icon: Package, label: "Inventory" },
  { to: "/sales", icon: ShoppingCart, label: "Sales" },
  { to: "/expenses", icon: Receipt, label: "Expenses" },
  { to: "/audits", icon: ClipboardCheck, label: "Audits" },
  { to: "/reports", icon: BarChart3, label: "Reports" },
  { to: "/customers", icon: Users, label: "Customers" },
  { to: "/suppliers", icon: Truck, label: "Suppliers" },
  { to: "/staff", icon: UserCog, label: "Staff" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, setProfile } = useStore();
  const { logout, refreshUser } = useAuth();
  const [time, setTime] = useState(new Date());
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleDark = () => setProfile({ ...profile, darkMode: !profile.darkMode });

  useEffect(() => {
    const handleOffline = () => {
      if (hasAuthenticatedOfflineSession()) {
        markOfflineSession();
        toast.info("Offline mode is active.", { description: "Sales, expenses, and inventory edits will save locally and sync when internet returns." });
      }
    };

    window.addEventListener("offline", handleOffline);
    return () => window.removeEventListener("offline", handleOffline);
  }, [location.pathname]);

  useEffect(() => {
    const syncQueuedActions = async (showErrors = true) => {
      if (syncInFlightRef.current || !navigator.onLine || !getAccessToken()) return false;
      const queue = getOfflineQueue();
      if (queue.length === 0) {
        clearOfflineQueue();
        return true;
      }

      syncInFlightRef.current = true;
      try {
        const result = await pushOfflineActions(queue);
        const syncSucceeded = (result.errors?.length ?? 0) === 0;
        if (syncSucceeded) {
          clearOfflineQueue();
        }
        if (result.processed > 0 && syncSucceeded) {
          toast.success(`Synced ${result.processed} offline changes`);
          await refreshUser();
        }
        if (result.errors?.length) {
          toast.warning(`${result.errors.length} offline changes need review.`, { description: "Open Settings to resolve sync conflicts." });
        }
        return syncSucceeded;
      } catch (error) {
        console.warn("Offline sync failed", error);
        if (showErrors) {
          toast.error("Offline sync failed. We will retry when your connection is stable.");
        }
        return false;
      } finally {
        syncInFlightRef.current = false;
      }
    };

    const cleanup = setupOfflineSync(async () => syncQueuedActions(true));
    if (navigator.onLine) {
      window.setTimeout(() => void syncQueuedActions(false), 1500);
    }
    return cleanup;
  }, [refreshUser]);
  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const initials = profile.name
    ? profile.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  return (
    <div className="min-h-screen bg-background flex">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-foreground/20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-sidebar flex flex-col transition-transform lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between h-16 px-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground">
              <CheckCircle className="h-5 w-5" />
            </div>
            <span className="font-display font-bold text-sidebar-foreground">Verifin</span>
          </div>
          <button className="lg:hidden text-sidebar-foreground" onClick={() => setSidebarOpen(false)} title="Close sidebar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                }`
              }
            >
              <item.icon className="h-4.5 w-4.5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-sidebar-border">
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="flex items-center gap-2 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:text-destructive transition-colors w-full text-left"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-16 bg-background/80 backdrop-blur-lg border-b border-border flex items-center px-4 lg:px-8 gap-4">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)} title="Open sidebar">
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="font-display font-semibold text-lg capitalize">
            {navItems.find((i) => location.pathname.startsWith(i.to))?.label || "Dashboard"}
          </h1>
          <div className="ml-auto flex items-center gap-3">
            {/* Time display - hidden on mobile */}
            <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span className="font-mono">{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="hidden lg:inline">· {time.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>
            </div>
            <NotificationCenter />
            <button onClick={toggleDark} className="p-2 rounded-lg hover:bg-muted transition-colors">
              {profile.darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => navigate("/settings")}
              className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary hover:bg-primary/20 transition-colors"
            >
              {initials}
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
};

export default AppLayout;
