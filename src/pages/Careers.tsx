import { Briefcase, MapPin, Clock, ArrowRight, Globe, Rocket, Handshake, Lightbulb } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const openings = [
  { title: "Senior Full-Stack Developer", team: "Engineering", location: "Remote (Africa)", type: "Full-Time", desc: "Build and scale the Verifin platform using React, TypeScript, and Python. Work on AI features, offline-first architecture, and real-time data pipelines." },
  { title: "Product Designer (UI/UX)", team: "Design", location: "Johannesburg / Remote", type: "Full-Time", desc: "Design intuitive, mobile-first interfaces for SME operators. Conduct user research across African markets and translate insights into beautiful, functional designs." },
  { title: "DevOps Engineer", team: "Engineering", location: "Remote (Africa)", type: "Full-Time", desc: "Manage cloud infrastructure, CI/CD pipelines, and ensure 99.9% uptime. Experience with PostgreSQL, Docker, and African hosting providers preferred." },
  { title: "Customer Success Manager", team: "Operations", location: "Johannesburg", type: "Full-Time", desc: "Onboard and support SME clients across South Africa and Zimbabwe. Help businesses get the most out of Verifin with training, best practices, and proactive engagement." },
  { title: "Marketing Intern", team: "Growth", location: "Johannesburg", type: "Internship", desc: "Support digital marketing campaigns, social media content, and community building for Verifin across African markets." },
];

const values = [
  { icon: Globe, title: "Africa First", desc: "We build for African businesses, understanding local challenges and opportunities." },
  { icon: Rocket, title: "Move Fast", desc: "We ship quickly, iterate based on feedback, and prioritize impact over perfection." },
  { icon: Handshake, title: "Customer Obsessed", desc: "Every feature starts with a real SME problem. We listen, learn, and deliver." },
  { icon: Lightbulb, title: "Think Big", desc: "We're building the operating system for millions of African businesses." },
];

const Careers = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="py-16 px-4">
      <div className="container max-w-4xl">
        <div className="text-center mb-12">
          <h1 className="font-display font-bold text-3xl mb-3">Join the Verifin Team</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">Help us build the future of business management for African SMEs. We're looking for passionate people who want to make a real impact.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          {values.map(v => (
            <Card key={v.title} className="shadow-soft">
              <CardContent className="p-5">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                  <v.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-display font-semibold mb-1">{v.title}</h3>
                <p className="text-sm text-muted-foreground">{v.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <h2 className="font-display font-bold text-xl mb-6">Open Positions</h2>
        <div className="space-y-4">
          {openings.map(job => (
            <Card key={job.title} className="shadow-soft hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-display font-semibold text-lg">{job.title}</h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs"><Briefcase className="h-3 w-3 mr-1" />{job.team}</Badge>
                      <Badge variant="secondary" className="text-xs"><MapPin className="h-3 w-3 mr-1" />{job.location}</Badge>
                      <Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 mr-1" />{job.type}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">{job.desc}</p>
                  </div>
                  <Button variant="outline" className="shrink-0" onClick={() => window.location.href = `mailto:careers@verifin.co.za?subject=Application: ${job.title}`}>
                    Apply <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 text-center p-8 rounded-2xl bg-muted/50">
          <h3 className="font-display font-semibold text-lg mb-2">Don't see your role?</h3>
          <p className="text-sm text-muted-foreground mb-3">We're always looking for talented people. Send your CV to <strong>careers@verifin.co.za</strong> and tell us how you'd contribute.</p>
        </div>
      </div>
    </section>
    <Footer />
  </div>
);

export default Careers;
