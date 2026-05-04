import { useLocation } from "react-router-dom";
import { SEO } from "@/components/SEO";

const routeMeta: Record<string, { title: string; description: string; noindex?: boolean }> = {
  "/": {
    title: "Verifin - Smart Inventory & Admin for African SMEs",
    description: "Automate admin, control stock, track sales and expenses, run audits, and work offline with Verifin.",
  },
  "/pricing": {
    title: "Verifin Pricing - Inventory and Admin Software for SMEs",
    description: "Compare Verifin plans for African SMEs. Start free, then unlock inventory automation, audits, reports, OCR, and AI assistance.",
  },
  "/demo": {
    title: "Verifin Demo - See Inventory, Sales, Audits and Reports",
    description: "Try the Verifin product tour and see how sales, stock, expenses, audits, customer loyalty, and reports work together.",
  },
  "/about": {
    title: "About Verifin - Business Software Built for African SMEs",
    description: "Learn how Verifin helps African SMEs reduce stock loss, automate admin, and get clearer visibility into their business.",
  },
  "/contact": {
    title: "Contact Verifin - Talk to Our SME Software Team",
    description: "Contact Verifin for questions about inventory management, sales tracking, admin automation, pricing, and business software support.",
  },
  "/api": {
    title: "Verifin API - Business Data Integrations",
    description: "Explore Verifin API access for inventory, sales, expenses, customers, audits, reports, and business integrations.",
  },
  "/help": {
    title: "Verifin Help Center - Inventory and Admin Support",
    description: "Find Verifin support articles for inventory, sales, expenses, audits, reports, offline mode, and app installation.",
  },
  "/careers": {
    title: "Verifin Careers - Build Software for African SMEs",
    description: "Join Verifin and help build practical business software for African SMEs.",
  },
  "/login": {
    title: "Login to Verifin",
    description: "Sign in to your Verifin account.",
    noindex: true,
  },
  "/dashboard": {
    title: "Verifin Dashboard",
    description: "Your private Verifin dashboard.",
    noindex: true,
  },
};

const privatePrefixes = ["/inventory", "/sales", "/expenses", "/audits", "/reports", "/customers", "/suppliers", "/staff", "/settings", "/billing", "/onboarding"];

export function RouteSEO() {
  const { pathname } = useLocation();
  const exactMeta = routeMeta[pathname];
  const isPrivate = privatePrefixes.some((prefix) => pathname.startsWith(prefix));

  const meta = exactMeta || {
    title: isPrivate ? "Verifin App" : "Verifin - Smart Inventory & Admin for African SMEs",
    description: isPrivate ? "Private Verifin app page." : "Business software for African SMEs to manage stock, sales, expenses, audits, reports, and offline operations.",
    noindex: isPrivate,
  };

  return <SEO title={meta.title} description={meta.description} path={pathname} noindex={meta.noindex} />;
}
