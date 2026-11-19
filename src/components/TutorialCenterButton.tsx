import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TutorialId = "product" | "sale" | "expense" | "reports";

const tutorials: Array<{
  id: TutorialId;
  title: string;
  description: string;
  destination: string;
  action: string;
  steps: string[];
}> = [
  {
    id: "product",
    title: "Add a product",
    description: "Set up an item so Verifin can track its stock and sales.",
    destination: "/inventory",
    action: "Open Inventory",
    steps: [
      "Open Inventory and choose Add Product.",
      "Enter the product name and choose a category.",
      "Enter its opening stock, reorder point, unit cost, and selling price. A barcode is optional.",
      "Choose Add Product. The product will be available to select when recording a sale.",
    ],
  },
  {
    id: "sale",
    title: "Record a sale",
    description: "Save a sale and keep stock levels up to date.",
    destination: "/sales",
    action: "Open Sales",
    steps: [
      "Make sure the products you sold are in Inventory and have stock available.",
      "Open Sales and choose Record Sale.",
      "Select each product, enter the quantity, and review the total.",
      "Choose the payment method and record the sale. Verifin updates stock for you.",
    ],
  },
  {
    id: "expense",
    title: "Log an expense",
    description: "Keep business costs together with your sales records.",
    destination: "/expenses",
    action: "Open Expenses",
    steps: [
      "Open Expenses and choose Add Expense.",
      "Enter a clear description, amount, and date.",
      "Choose a category and currency. You can also assign a branch or attach a receipt where available.",
      "Choose Add Expense. The expense will be included in reports according to your account permissions and approval settings.",
    ],
  },
  {
    id: "reports",
    title: "Read your reports",
    description: "Review business activity after you have recorded transactions.",
    destination: "/reports",
    action: "Open Reports",
    steps: [
      "Open Reports after recording sales, expenses, or stock movements.",
      "Choose a reporting period that matches the dates you want to review.",
      "Compare the totals, charts, and tables to see how your business is performing.",
      "Use an available export option when you need to save or share a report.",
    ],
  },
];

interface TutorialCenterButtonProps {
  initialTutorial?: TutorialId;
  label?: string;
}

export function TutorialCenterButton({ initialTutorial = "product", label = "Quick tutorials" }: TutorialCenterButtonProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<TutorialId>(initialTutorial);
  const selectedTutorial = tutorials.find((tutorial) => tutorial.id === selectedId) ?? tutorials[0];

  const openTutorials = () => {
    setSelectedId(initialTutorial);
    setOpen(true);
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openTutorials} className="gap-2">
        <BookOpen className="h-4 w-4" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="font-display">Quick tutorials</DialogTitle>
            <DialogDescription>
              Learn common tasks at your own pace. These guides are optional and can be reopened any time.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tutorials.map((tutorial) => (
              <button
                key={tutorial.id}
                type="button"
                aria-pressed={selectedId === tutorial.id}
                onClick={() => setSelectedId(tutorial.id)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${selectedId === tutorial.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted"}`}
              >
                {tutorial.title}
              </button>
            ))}
          </div>

          <section className="rounded-xl border border-border bg-muted/30 p-4 sm:p-5" aria-live="polite">
            <h3 className="font-display text-lg font-semibold">{selectedTutorial.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{selectedTutorial.description}</p>
            <ol className="mt-4 space-y-3">
              {selectedTutorial.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                You can come back and repeat these steps whenever you need.
              </p>
              <Button type="button" onClick={() => { setOpen(false); navigate(selectedTutorial.destination); }} className="gap-2">
                {selectedTutorial.action}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
