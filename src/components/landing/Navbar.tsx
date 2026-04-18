import { useState } from "react";
import { Menu, X, CheckCircle, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";

const Navbar = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === "/";
  const { profile, setProfile } = useStore();
  const { isAuthenticated } = useAuth();
  const primaryPath = isAuthenticated ? "/dashboard" : "/login?signup=1";
  const primaryLabel = isAuthenticated ? "Dashboard" : "Start Free";

  const toggleDark = () => setProfile({ ...profile, darkMode: !profile.darkMode });

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container flex h-16 items-center justify-between">
        <button onClick={() => navigate("/")} className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-hero flex items-center justify-center text-primary-foreground">
            <CheckCircle className="h-5 w-5" />
          </div>
          <span className="font-display font-bold text-lg">Verifin</span>
        </button>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
          {isHome ? <a href="#features" className="hover:text-foreground transition-colors">Features</a> : <button onClick={() => navigate("/#features")} className="hover:text-foreground transition-colors">Features</button>}
          <button onClick={() => navigate("/pricing")} className="hover:text-foreground transition-colors">Pricing</button>
          <button onClick={() => navigate("/about")} className="hover:text-foreground transition-colors">About</button>
          <button onClick={() => navigate("/demo")} className="hover:text-foreground transition-colors">Demo</button>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <button onClick={toggleDark} className="p-2 rounded-lg hover:bg-muted transition-colors">
            {profile.darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {!isAuthenticated && <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>Log in</Button>}
          <Button size="sm" className="bg-gradient-hero text-primary-foreground" onClick={() => navigate(primaryPath)}>
            {primaryLabel}
          </Button>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <button onClick={toggleDark} className="p-2 rounded-lg hover:bg-muted transition-colors">
            {profile.darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-border bg-background p-4 space-y-3">
          <button onClick={() => { navigate("/pricing"); setOpen(false); }} className="block text-sm py-2 w-full text-left">Pricing</button>
          <button onClick={() => { navigate("/about"); setOpen(false); }} className="block text-sm py-2 w-full text-left">About</button>
          <button onClick={() => { navigate("/demo"); setOpen(false); }} className="block text-sm py-2 w-full text-left">Demo</button>
          <Button className="w-full bg-gradient-hero text-primary-foreground" onClick={() => { navigate(primaryPath); setOpen(false); }}>
            {isAuthenticated ? "Dashboard" : "Get Started"}
          </Button>
        </div>
      )}
    </header>
  );
};

export default Navbar;
