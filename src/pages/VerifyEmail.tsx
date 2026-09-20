import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
      toast.success("Email verified. Welcome to Verifin!");
      navigate("/dashboard", { replace: true });
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
    <Card className="w-full max-w-md"><CardContent className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Verify your email</h1>
      <p className="text-sm" role="status">{message}</p>
      <>
        {state?.email && <p className="text-sm">Account: {state.email}</p>}
        <p className="text-sm text-muted-foreground">Email signup accounts remain pending until verified. Check your spam folder too.</p>
        {token && <Button onClick={() => void confirm()} disabled={busy || isLoading} className="w-full">{busy ? "Verifying and signing in..." : "Verify my email & sign in"}</Button>}
        <form onSubmit={resend} className="space-y-3">
          <label htmlFor="verification-email" className="text-sm">Email address</label>
          <Input id="verification-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
          <Button type="submit" variant="outline" disabled={busy} className="w-full">Resend verification email</Button>
        </form>
      </>
      <Button asChild variant="outline" className="w-full"><Link to="/login">Go to sign in</Link></Button>
    </CardContent></Card>
  </div>;
};
export default VerifyEmail;
