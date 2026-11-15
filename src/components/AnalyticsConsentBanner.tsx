import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const CONSENT_KEY = "verifin:site-analytics-consent";
const MEASUREMENT_ID = "G-52Z8KTEDCK";
type ConsentChoice = "allowed" | "essential";

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
  }
}

function clearAnalyticsCookies() {
  document.cookie.split(";").forEach((cookie) => {
    const name = cookie.split("=")[0]?.trim();
    if (name?.startsWith("_ga")) document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  });
}

function setAnalyticsConsent(choice: ConsentChoice) {
  localStorage.setItem(CONSENT_KEY, choice);
  if (choice === "essential") {
    window.gtag?.("consent", "update", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    document.getElementById("verifin-google-analytics")?.remove();
    clearAnalyticsCookies();
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = (...args: unknown[]) => window.dataLayer?.push(args);
  window.gtag("js", new Date());
  window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  window.gtag("config", MEASUREMENT_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  if (!document.getElementById("verifin-google-analytics")) {
    const script = document.createElement("script");
    script.id = "verifin-google-analytics";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }
}

const AnalyticsConsentBanner = () => {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored === "allowed" || stored === "essential") {
      setChoice(stored);
      if (stored === "allowed") setAnalyticsConsent("allowed");
    } else {
      setOpen(true);
    }
    const showPreferences = () => setOpen(true);
    window.addEventListener("verifin:manage-analytics-consent", showPreferences);
    return () => window.removeEventListener("verifin:manage-analytics-consent", showPreferences);
  }, []);

  const saveChoice = (next: ConsentChoice) => {
    setAnalyticsConsent(next);
    setChoice(next);
    setOpen(false);
  };

  return open ? (
    <section aria-labelledby="analytics-consent-title" className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-3xl rounded-xl border border-border bg-card p-4 shadow-elevated sm:bottom-5 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h2 id="analytics-consent-title" className="font-semibold">Choose your analytics preference</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">Essential storage keeps Verifin working. Optional Google Analytics measures site visits and loads only if you allow it. Advertising personalization is disabled. <Link to="/privacy" className="font-medium text-primary underline underline-offset-2">Read the Privacy Policy</Link></p>
        </div>
        <div className="flex flex-row gap-2 sm:min-w-40 sm:flex-col">
          <button type="button" onClick={() => saveChoice("allowed")} className="min-h-10 flex-1 rounded-md bg-primary px-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:flex-auto sm:px-4">Allow analytics</button>
          <button type="button" onClick={() => saveChoice("essential")} className="min-h-10 flex-1 rounded-md border border-border px-2 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:flex-auto sm:px-4">Essential only</button>
        </div>
      </div>
    </section>
  ) : null;
};

export default AnalyticsConsentBanner;
