import { ArrowRight, Boxes, ClipboardList, Store, WifiOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const focusAreas = [
  { icon: Boxes, title: "Stock that is easier to follow", description: "Keep product quantities, stock movements, suppliers and purchase activity together." },
  { icon: ClipboardList, title: "Daily records in one workspace", description: "Record sales and expenses, then review the activity in business summaries and reports." },
  { icon: WifiOff, title: "Work through patchy connections", description: "Selected sales, stock and expense actions can be queued on your device and synced when you reconnect." },
];

const About = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <section className="border-b border-border bg-gradient-to-b from-primary/10 to-background px-4 py-16 sm:py-20">
          <div className="container max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">About Verifin</p>
            <h1 className="mt-4 max-w-3xl font-display text-3xl font-bold tracking-tight sm:text-5xl">Practical business tools for the work behind every sale</h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Verifin is a business management platform being built to help African small businesses keep stock, sales, expenses and day-to-day records easier to manage.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => navigate("/demo")} className="min-h-11 bg-gradient-hero text-primary-foreground">Explore the product tour <ArrowRight className="ml-2 h-4 w-4" /></Button>
              <Button variant="outline" onClick={() => navigate("/pricing")} className="min-h-11">View plans</Button>
            </div>
          </div>
        </section>

        <section className="px-4 py-14 sm:py-16">
          <div className="container max-w-5xl">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent-foreground"><Store className="h-5 w-5" aria-hidden="true" /></div>
                <h2 className="font-display text-2xl font-bold sm:text-3xl">Why we are building it</h2>
              </div>
              <div className="space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                <p>Many owners manage product counts, daily sales and spending across notebooks, spreadsheets and separate apps. That makes it harder to spot missing stock, understand the day’s results or find a record when it is needed.</p>
                <p>Verifin brings those routine jobs into one workspace, with tools for inventory, sales, expenses, customers, suppliers, staff and reporting. The aim is to make business administration clearer without asking owners to become accountants or IT specialists.</p>
                <p>We focus on independent retailers and service-led small businesses, including grocery shops, hardware stores, boutiques, tuckshops and bakeries. The product is designed around practical mobile use and the connectivity conditions businesses may face across African markets.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 px-4 py-14 sm:py-16">
          <div className="container max-w-5xl">
            <div className="max-w-2xl">
              <h2 className="font-display text-2xl font-bold sm:text-3xl">What Verifin helps bring together</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">The product is centered on clear records and useful daily workflows.</p>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {focusAreas.map((area) => (
                <Card key={area.title} className="h-full shadow-soft">
                  <CardContent className="p-5">
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"><area.icon className="h-5 w-5 text-primary" aria-hidden="true" /></div>
                    <h3 className="font-display font-semibold">{area.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{area.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-14 sm:py-16">
          <div className="container max-w-5xl rounded-2xl bg-gradient-hero p-7 text-primary-foreground sm:p-10">
            <h2 className="font-display text-2xl font-bold sm:text-3xl">Our mission</h2>
            <p className="mt-3 max-w-3xl leading-relaxed text-primary-foreground/85">Simplify business management for African businesses with tools that help owners understand their operations and spend more time serving customers.</p>
            <div className="mt-6 flex flex-wrap gap-5 text-sm font-semibold">
              <Link to="/privacy" className="underline underline-offset-4">Read our Privacy Policy</Link>
              <Link to="/contact" className="underline underline-offset-4">Get in touch</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default About;
