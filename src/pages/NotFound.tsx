import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Boxes, Home, LifeBuoy, Search, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

const quickLinks = [
  { label: "Dashboard", path: "/dashboard", icon: BarChart3, hint: "Business snapshot" },
  { label: "Inventory", path: "/inventory", icon: Boxes, hint: "Stock and products" },
  { label: "Sales", path: "/sales", icon: WalletCards, hint: "Receipts and tills" },
  { label: "Help Center", path: "/help", icon: LifeBuoy, hint: "Guides and support" },
];

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [query, setQuery] = useState("");
  const [spotlight, setSpotlight] = useState({ x: 50, y: 34 });

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  const filteredLinks = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return quickLinks;
    return quickLinks.filter((link) => `${link.label} ${link.hint}`.toLowerCase().includes(term));
  }, [query]);

  const primaryPath = isAuthenticated ? "/dashboard" : "/";
  const primaryLabel = isAuthenticated ? "Open dashboard" : "Go home";

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-background text-foreground"
      onMouseMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setSpotlight({
          x: ((event.clientX - bounds.left) / bounds.width) * 100,
          y: ((event.clientY - bounds.top) / bounds.height) * 100,
        });
      }}
      style={{
        background: `radial-gradient(circle at ${spotlight.x}% ${spotlight.y}%, hsl(var(--accent) / 0.16), transparent 24rem), hsl(var(--background))`,
      }}
    >
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(hsl(var(--foreground))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--foreground))_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="absolute left-1/2 top-24 h-72 w-72 -translate-x-1/2 rounded-full border border-primary/20" />
      <div className="absolute bottom-16 right-8 hidden h-36 w-36 rounded-full border border-accent/30 md:block" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="container flex h-16 items-center justify-between">
          <button onClick={() => navigate("/")} className="flex items-center text-foreground" aria-label="Go to Verifin home">
            <Logo className="h-10 w-auto sm:h-11" />
          </button>
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </header>

        <section className="container grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1fr_420px] lg:py-16">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              <ShieldCheck className="h-4 w-4" />
              Route check failed
            </div>

            <p className="font-display text-8xl font-bold leading-none text-primary sm:text-9xl">404</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-normal sm:text-5xl">
              This page wandered off the ledger.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              The address does not match an active Verifin screen. Try a trusted shortcut, search the common routes, or head back to familiar ground.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button className="bg-gradient-hero text-primary-foreground" size="lg" onClick={() => navigate(primaryPath)}>
                <Home className="h-4 w-4" />
                {primaryLabel}
              </Button>
              <Button variant="outline" size="lg" onClick={() => navigate("/help")}>
                <LifeBuoy className="h-4 w-4" />
                Get help
              </Button>
            </div>
          </div>

          <aside className="rounded-lg border border-border bg-card/90 p-4 shadow-elevated backdrop-blur">
            <div className="flex items-center gap-2 border-b border-border pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Find your way</h2>
                <p className="text-sm text-muted-foreground">Current path: {location.pathname}</p>
              </div>
            </div>

            <label className="mt-4 flex h-11 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search routes"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>

            <div className="mt-4 grid gap-2">
              {filteredLinks.length ? (
                filteredLinks.map((link) => {
                  const Icon = link.icon;
                  return (
                    <button
                      key={link.path}
                      onClick={() => navigate(link.path)}
                      className="group flex items-center justify-between rounded-md border border-border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground group-hover:bg-primary group-hover:text-primary-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{link.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{link.hint}</span>
                        </span>
                      </span>
                      <span className="text-sm text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary">/</span>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No matching shortcut. Try dashboard, inventory, sales, or help.
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
};

export default NotFound;
