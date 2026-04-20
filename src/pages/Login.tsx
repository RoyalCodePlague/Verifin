import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, Mail, Lock, Eye, EyeOff, User, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { resendVerificationRequest } from "@/lib/api";
import { toast } from "sonner";

function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full opacity-20 animate-pulse"
          style={{
            width: `${120 + i * 60}px`,
            height: `${120 + i * 60}px`,
            left: `${10 + i * 15}%`,
            top: `${10 + (i % 3) * 30}%`,
            background: `radial-gradient(circle, hsl(var(--primary) / 0.15), transparent)`,
            animationDelay: `${i * 0.8}s`,
            animationDuration: `${3 + i * 0.5}s`,
          }}
        />
      ))}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-primary/5 rounded-full blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl animate-[pulse_8s_ease-in-out_infinite_1s]" />
    </div>
  );
}

const Login = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [resending, setResending] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, register } = useAuth();

  useEffect(() => {
    if (searchParams.get("signup") === "1") setIsSignUp(true);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) return;
    setLoading(true);
    try {
      if (isSignUp) {
        const message = await register(form.email, form.password, form.name.trim() || undefined);
        setPendingVerificationEmail(form.email);
        setIsSignUp(false);
        toast.success(message || "Account created. Check your email to verify it.");
      } else {
        await login(form.email, form.password);
        toast.success("Welcome back!");
        navigate("/dashboard");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    toast.message("Google sign-in is not connected yet. Please use email and password.");
  };

  const handleResendVerification = async () => {
    const email = pendingVerificationEmail || form.email;
    if (!email) {
      toast.error("Enter your email first.");
      return;
    }
    setResending(true);
    try {
      const res = await resendVerificationRequest(email);
      toast.success(res.detail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend verification email.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <AnimatedBackground />

      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button onClick={() => navigate("/")} className="inline-flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-gradient-hero flex items-center justify-center text-primary-foreground">
                <CheckCircle className="h-6 w-6" />
              </div>
              <span className="font-display font-bold text-2xl">Verifin</span>
            </button>
            <div className="w-16" />
          </div>
          <h1 className="font-display font-bold text-2xl mb-1">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSignUp ? "Start managing your business smarter" : "Sign in to your dashboard"}
          </p>
        </div>

        <Card className="shadow-elevated backdrop-blur-sm bg-card/95">
          <CardContent className="p-6">
            <>
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 mb-4 gap-3 font-medium"
              disabled={loading}
              onClick={handleGoogleSignIn}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </Button>

            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {pendingVerificationEmail && !isSignUp && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                  <p className="font-medium">Verify your email to sign in.</p>
                  <p className="mt-1 text-muted-foreground">We sent a verification link to {pendingVerificationEmail}.</p>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resending}
                    className="mt-2 text-primary font-medium hover:underline disabled:opacity-60"
                  >
                    {resending ? "Sending..." : "Resend verification email"}
                  </button>
                </div>
              )}
              {isSignUp && (
                <div>
                  <Label>Full Name</Label>
                  <div className="relative mt-1.5">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="John Doe" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="pl-9" />
                  </div>
                </div>
              )}
              <div>
                <Label>Email</Label>
                <div className="relative mt-1.5">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="email" placeholder="you@business.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="pl-9" required />
                </div>
              </div>
              <div>
                <Label>Password</Label>
                <div className="relative mt-1.5">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="pl-9 pr-10" required minLength={8} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2">
                    {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </button>
                </div>
              </div>

              <Button type="submit" disabled={loading} className="w-full bg-gradient-hero text-primary-foreground h-11">
                {loading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">
                {isSignUp ? "Already have an account?" : "Don't have an account?"}
              </span>{" "}
              <button type="button" onClick={() => setIsSignUp(!isSignUp)} className="text-primary font-medium hover:underline">
                {isSignUp ? "Sign in" : "Sign up"}
              </button>
            </div>
            </>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
