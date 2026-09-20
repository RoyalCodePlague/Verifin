import { useEffect, useRef, useState } from "react";
import { googleConfigRequest } from "@/lib/api";

type GoogleIdentity = {
  initialize: (options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; auto_select: boolean }) => void;
  renderButton: (element: HTMLElement, options: { type: string; theme: string; size: string; text: string; width: number }) => void;
};
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } }; } }
let loadingScript: Promise<void> | undefined;
function loadGoogle() {
  if (window.google?.accounts.id) return Promise.resolve();
  if (!loadingScript) {
    loadingScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      const timeout = window.setTimeout(() => { script.remove(); reject(new Error("Google sign-in took too long to load.")); }, 15000);
      script.onload = () => { window.clearTimeout(timeout); resolve(); };
      script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error("Google sign-in could not load.")); };
      document.head.appendChild(script);
    }).catch((error) => { loadingScript = undefined; throw error; });
  }
  return loadingScript;
}

export function GoogleSignIn({ onCredential, disabled }: { onCredential: (credential: string, nonce: string) => Promise<void>; disabled: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const busy = useRef(disabled);
  callback.current = onCredential;
  busy.current = disabled;
  const [message, setMessage] = useState("Loading Google sign-in...");
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { element.current?.toggleAttribute("inert", disabled); }, [disabled]);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setMessage("Loading Google sign-in...");
    const target = element.current;
    target?.replaceChildren();
    (async () => {
      const config = await googleConfigRequest();
      if (cancelled) return;
      if (!config.client_id || !config.nonce) { setMessage("Google sign-in is not available yet. Use email below."); return; }
      await loadGoogle();
      if (cancelled || !target || !window.google) return;
      const nonce = config.nonce;
      window.google.accounts.id.initialize({ client_id: config.client_id, nonce, auto_select: false, callback: (response) => {
        if (!cancelled && !busy.current) void callback.current(response.credential, nonce).finally(() => { if (!cancelled) setAttempt((value) => value + 1); });
      } });
      window.google.accounts.id.renderButton(target, { type: "standard", theme: "outline", size: "large", text: "continue_with", width: 320 });
      setMessage("");
    })().catch(() => { if (!cancelled) { setMessage("Google sign-in could not load. Try again or use email below."); setFailed(true); } });
    // Refresh the server-signed nonce before its ten-minute expiry.
    const timer = window.setTimeout(() => setAttempt((value) => value + 1), 8 * 60_000);
    return () => { cancelled = true; window.clearTimeout(timer); target?.replaceChildren(); };
  }, [attempt]);
  return <div className="mb-4">
    <div ref={element} className={`flex justify-center ${disabled ? "pointer-events-none opacity-50" : ""}`} />
    {message && <p role="status" className="text-center text-sm text-muted-foreground">{message}</p>}
    {failed && <button type="button" className="mt-2 w-full text-sm underline" onClick={() => setAttempt((value) => value + 1)}>Retry Google sign-in</button>}
  </div>;
}
