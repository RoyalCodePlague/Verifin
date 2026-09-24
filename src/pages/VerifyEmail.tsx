import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resendVerificationRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

const VerifyEmail = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { verifyEmail, isLoading } = useAuth();
  useEffect(() => {
    const policy = document.createElement("meta");
    policy.name = "referrer";
    policy.content = "no-referrer";
    document.head.appendChild(policy);
    return () => policy.remove();
  }, []);
  const state = useLocation().state as { email?: string; emailSent?: boolean; detail?: string } | null;
  const [token] = useState(() => params.get("token") || "");
  const [email, setEmail] = useState(state?.email || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(state?.detail || (token ? "Confirm your email to activate your account and sign in." : "Enter your signup email to request a verification link."));
  const confirm = async () => {
    setBusy(true);
    try {
      await verifyEmail(token);
      toast.success("Email verified. You can now sign in.");
      navigate("/login", { replace: true, state: { email, verificationNotice: "Your email is verified. Sign in to open your workspace." } });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Verification failed."); }
    finally { setBusy(false); }
  };
  const resend = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { setMessage((await resendVerificationRequest(email)).detail); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not send email."); }
    finally { setBusy(false); }
  };
  return <div className="min-h-screen flex items-center justify-center bg-background p-4">
    <Card className="w-full max-w-md overflow-hidden shadow-elevated"><div className="h-1.5 bg-gradient-hero" /><CardContent className="space-y-5 p-6 sm:p-8">
      <div className="text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"><Mail className="h-7 w-7 text-primary" /></div><h1 className="font-display text-2xl font-bold">Verify your email</h1><p className="mt-2 text-sm text-muted-foreground">One last step to activate your Verifin account.</p></div>
      <div role="status" className="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed">{message}</div>
      {state?.email && <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary"><CheckCircle2 className="h-4 w-4 shrink-0" />Verification email sent to <strong className="truncate">{state.email}</strong></div>}
      {token && <Button onClick={() => void confirm()} disabled={busy || isLoading} className="h-11 w-full bg-gradient-hero text-primary-foreground">{busy ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Verifying your email...</> : <><ShieldCheck className="mr-2 h-4 w-4" />Verify email</>}</Button>}
      <form onSubmit={resend} className="space-y-3 border-t border-border pt-5">
        <div><label htmlFor="verification-email" className="text-sm font-medium">Need another link?</label><p className="mt-1 text-xs text-muted-foreground">Enter the email you used to create your account.</p></div>
        <Input id="verification-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@business.com" />
        <Button type="submit" variant="outline" disabled={busy || !email} className="h-11 w-full border-primary/30 bg-primary/5 font-semibold text-primary hover:bg-primary hover:text-primary-foreground">{busy ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Sending link...</> : <><RefreshCw className="mr-2 h-4 w-4" />Resend verification email</>}</Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">Check your spam folder too. For your protection, verification links expire after 24 hours.</p>
      <Button asChild variant="ghost" className="w-full"><Link to="/login">Back to sign in</Link></Button>
    </CardContent></Card>
  </div>;
};
export default VerifyEmail;
