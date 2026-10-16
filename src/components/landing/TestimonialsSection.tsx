import { useNavigate } from "react-router-dom";
import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

const TestimonialsSection = () => {
  const navigate = useNavigate();

  return (
    <section className="bg-background px-4 py-16">
      <div className="container rounded-2xl border border-border bg-muted/30 p-8 text-center sm:p-12">
        <Play className="mx-auto mb-4 h-8 w-8 text-primary" />
        <h2 className="font-display text-3xl font-bold">See how a shop day works in Verifin</h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">Explore a sample sale, stock update and business summary in the interactive demo. No account needed.</p>
        <Button className="mt-6" onClick={() => navigate("/demo")}>Explore the demo <ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
    </section>
  );
};

export default TestimonialsSection;
