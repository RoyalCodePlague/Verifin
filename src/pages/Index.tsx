import Navbar from "@/components/landing/Navbar";
import HeroSection from "@/components/landing/HeroSection";
import StatsSection from "@/components/landing/StatsSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import TrustSection from "@/components/landing/TrustSection";
import TestimonialsSection from "@/components/landing/TestimonialsSection";
import CTASection from "@/components/landing/CTASection";
import Footer from "@/components/landing/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <section className="border-y border-primary/10 bg-primary/5 px-4 py-8">
        <div className="container flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">No data? Keep selling.</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Save supported sales, stock updates and expenses on your device. They sync when you reconnect.</p>
          </div>
          <a href="/demo" className="text-sm font-semibold text-primary underline underline-offset-4">Try the interactive demo</a>
        </div>
      </section>
      <StatsSection />
      <FeaturesSection />
      <HowItWorksSection />
      <TrustSection />
      <TestimonialsSection />
      <CTASection />
      <Footer />
    </div>
  );
};

export default Index;
