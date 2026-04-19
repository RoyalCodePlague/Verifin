import { useState } from "react";
import { Mail, Phone, MapPin, Send, MessageSquare } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const Contact = () => {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Message sent! We'll get back to you within 24 hours.");
    setForm({ name: "", email: "", subject: "", message: "" });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="py-16 px-4">
        <div className="container max-w-5xl">
          <div className="text-center mb-12">
            <h1 className="font-display font-bold text-3xl mb-3">Contact Us</h1>
            <p className="text-muted-foreground max-w-lg mx-auto">Have questions about Verifin? We'd love to hear from you. Our team typically responds within 24 hours.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {[
              { icon: Mail, label: "Email", value: "robzmtambo@gmail.com", desc: "For general enquiries" },
              { icon: Phone, label: "Phone", value: "+263 77 695 0947", desc: "Mon-Fri, 8am-5pm" },
              { icon: MapPin, label: "Office", value: "Johannesburg, South Africa", desc: "Sandton City, Gauteng" },
            ].map((c) => (
              <Card key={c.label} className="shadow-soft text-center">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <c.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-display font-semibold mb-1">{c.label}</h3>
                  <p className="text-sm font-medium">{c.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{c.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="shadow-soft max-w-2xl mx-auto">
            <CardContent className="p-6">
              <h2 className="font-display font-semibold text-xl mb-4 flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" /> Send a Message
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><Label>Full Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1" required /></div>
                  <div><Label>Email Address</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="mt-1" required /></div>
                </div>
                <div><Label>Subject</Label><Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} className="mt-1" required /></div>
                <div><Label>Message</Label><Textarea rows={5} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} className="mt-1" required /></div>
                <Button type="submit" className="w-full bg-gradient-hero text-primary-foreground"><Send className="h-4 w-4 mr-2" /> Send Message</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Contact;
