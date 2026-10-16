import { useLocation } from "react-router-dom";
import { SEO } from "@/components/SEO";

const routeMeta: Record<string, { title: string; description: string; noindex?: boolean }> = {
  "/": {
    title: "Stock, Sales and Expenses for Zimbabwe Shops | Verifin",
    description: "Know what you sold, what is in stock, and where your money went. Verifin helps Zimbabwe shops track sales, stock and expenses, even with unreliable internet.",
  },
  "/pricing": {
    title: "Verifin Pricing | Plans for Zimbabwe Shops",
    description: "Compare Verifin Starter, Growth and Business plans. Zimbabwe prices are shown in USD. Start free; contact us about paid plan options.",
  },
  "/features": {
    title: "Verifin Features | Stock, Sales and Expenses",
    description: "See how Verifin helps shops record sales, keep stock in view, track expenses and review business performance, even when the internet drops.",
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
  "/privacy": {
    title: "Privacy Policy | Verifin",
    description: "Read how Verifin collects, uses and protects your account and business information, and learn about your privacy choices.",
  },
  "/terms": {
    title: "Terms of Service | Verifin",
    description: "Read the terms for using Verifin, including accounts, subscriptions, acceptable use and responsibilities.",
  },
  "/verify-email": {
    title: "Verify Your Email | Verifin",
    description: "Verify your email address to access your Verifin account.",
    noindex: true,
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
  const { pathname: rawPath } = useLocation();
  const pathname = rawPath.replace(/\/+$/, "") || "/";
  const exactMeta = routeMeta[pathname];
  const isPrivate = privatePrefixes.some((prefix) => pathname.startsWith(prefix));

  const meta = exactMeta || {
    title: isPrivate ? "Verifin App" : "Page Not Found | Verifin",
    description: isPrivate ? "Private Verifin app page." : "Business software for African SMEs to manage stock, sales, expenses, audits, reports, and offline operations.",
    noindex: true,
  };

  return <SEO title={meta.title} description={meta.description} path={pathname} noindex={meta.noindex} />;
}
