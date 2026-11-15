import { useState } from "react";
import { ArrowUpRight, Mail, MessageCircle, Send } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const SUPPORT_EMAIL = "verifin2026@gmail.com";
const SUPPORT_WHATSAPP = "https://wa.me/263775252409";

const Contact = () => {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [draftUrl, setDraftUrl] = useState("");

  const prepareEmail = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const subject = encodeURIComponent(`[Verifin support] ${form.subject.trim()}`);
    const body = encodeURIComponent(`Name: ${form.name.trim() || "Not provided"}\nReply email: ${form.email.trim()}\n\n${form.message.trim()}`);
    setDraftUrl(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <section className="border-b border-border bg-gradient-to-b from-primary/10 to-background px-4 py-14 sm:py-16">
          <div className="container max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Contact and support</p>
            <h1 className="mt-4 font-display text-3xl font-bold sm:text-4xl">Talk to the Verifin team</h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">Ask about getting started, billing, product use, privacy or a security concern. Choose email or WhatsApp; no response-time guarantee is published.</p>
          </div>
        </section>

        <section className="px-4 py-10 sm:py-14">
          <div className="container max-w-5xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="shadow-soft">
                <CardContent className="flex h-full flex-col p-5 sm:p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10"><Mail className="h-5 w-5 text-primary" aria-hidden="true" /></div>
                  <h2 className="font-display text-lg font-semibold">Email support</h2>
                  <p className="mt-2 flex-1 text-sm text-muted-foreground">For product help, privacy requests, billing questions or security concerns.</p>
                  <a className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                    {SUPPORT_EMAIL}<ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                </CardContent>
              </Card>
              <Card className="shadow-soft">
                <CardContent className="flex h-full flex-col p-5 sm:p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/20"><MessageCircle className="h-5 w-5 text-accent-foreground" aria-hidden="true" /></div>
                  <h2 className="font-display text-lg font-semibold">WhatsApp</h2>
                  <p className="mt-2 flex-1 text-sm text-muted-foreground">Message the existing Verifin support line. Check the number before sending your request.</p>
                  <a className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline" href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer">
                    +263 77 525 2409<ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">(opens WhatsApp in a new tab)</span>
                  </a>
                </CardContent>
              </Card>
            </div>

            <Card className="mx-auto mt-8 max-w-3xl shadow-soft">
              <CardContent className="p-5 sm:p-7">
                <h2 className="font-display text-xl font-semibold">Prepare an email request</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">This form prepares a draft in your email app. Verifin will not receive it until you review and send it there. If no email app opens, contact us directly at {SUPPORT_EMAIL}.</p>
                <form onSubmit={prepareEmail} className="mt-6 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><Label htmlFor="contact-name">Name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="contact-name" autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 min-h-11" /></div>
                    <div><Label htmlFor="contact-email">Reply email</Label><Input id="contact-email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1.5 min-h-11" required /></div>
                  </div>
                  <div><Label htmlFor="contact-subject">Subject</Label><Input id="contact-subject" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} className="mt-1.5 min-h-11" required maxLength={120} /></div>
                  <div><Label htmlFor="contact-message">How can we help?</Label><Textarea id="contact-message" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} className="mt-1.5 min-h-32" required maxLength={4000} /></div>
                  <Button type="submit" className="min-h-11 w-full bg-gradient-hero text-primary-foreground sm:w-auto"><Send className="mr-2 h-4 w-4" aria-hidden="true" />Prepare email draft</Button>
                </form>
                {draftUrl && <div role="status" className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                  <p className="font-semibold">Your draft is ready.</p>
                  <p className="mt-1 text-muted-foreground">Review its contents and send it from your email app.</p>
                  <a href={draftUrl} className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline">Open email draft <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>
                </div>}
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Contact;
