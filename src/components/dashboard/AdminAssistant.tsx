import { useState, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

function buildSuggestions(productNames: string[], _sym: string): string[] {
  const top = productNames.slice(0, 5);
  const low = productNames.slice(0, 3);
  const base = [
    "today sales",
    "low stock",
    "top products",
    "expenses",
    "customers",
    "reorder suggestions",
  ];
  if (top.length === 0) return base;
  const tailored = [
    top[0] ? `top products` : "",
    top[1] ? `low stock` : "",
    low[0] ? `reorder suggestions` : "",
    `today sales`,
  ].filter(Boolean);
  return [...tailored, ...base].slice(0, 10);
}

interface Message {
  id: string;
  text: string;
  from: "user" | "assistant";
}

type AdminAssistantProps = {
  /** When true (e.g. after adding a product), open the chat and focus prompts on this account. */
  autoExpand?: boolean;
  onDismissAutoExpand?: () => void;
};

export function AdminAssistant({ autoExpand = false, onDismissAutoExpand }: AdminAssistantProps) {
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addSale, addExpense, updateProduct, addProduct, products, sales, expenses, customers, profile } = useStore();

  const sym = profile.currencySymbol || "R";

  const suggestions = useMemo(
    () => buildSuggestions(products.map((p) => p.name), sym),
    [products, sym]
  );

  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  const handleApiResponse = (action: string, data: any, message: string) => {
    // Process API response and update local store
    try {
      if (action === "create_product") {
        const { id, name, stock, price, sku } = data;
        if (name) {
          // Check if product already exists
          const existingProduct = products.find(p => p.name.toLowerCase() === name.toLowerCase());
          if (!existingProduct) {
            addProduct({
              name,
              stock: stock || 0,
              price: price || 0,
              costPrice: 0,
              sku: sku || `SKU${products.length + 1}`,
              category: "General",
              reorder: 5
            });
            toast.success("✨ Product added to inventory!");
          } else {
            toast.info("💬 Product already exists");
          }
        }
      } else if (action === "restock_product") {
        const { id, name, stock } = data;
        if (id && stock !== undefined) {
          updateProduct(id, { stock });
          toast.success("✨ Stock updated!");
        } else if (name) {
          // Find product by name and update
          const product = products.find(p => p.name.toLowerCase() === name.toLowerCase());
          if (product) {
            updateProduct(product.id, { stock: stock || 0 });
            toast.success("✨ Stock updated!");
          }
        }
      } else if (action === "create_sale" || action === "record_sale") {
        const { quantity, product, total } = data;
        if (quantity && product) {
          addSale({
            items: `${quantity}x ${product}`,
            total: total || 0,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            date: "Today",
            method: "Cash",
          });
          
          // Update inventory
          const prod = products.find(p => p.name.toLowerCase() === product.toLowerCase());
          if (prod) {
            updateProduct(prod.id, { stock: Math.max(0, prod.stock - quantity) });
          }
          toast.success("💰 Sale recorded!");
        }
      } else if (action === "create_expense" || action === "log_expense") {
        const { description, amount, category } = data;
        if (description && amount) {
          addExpense({
            desc: description.charAt(0).toUpperCase() + description.slice(1),
            amount,
            date: "Today",
            category: category || "General",
          });
          toast.success("💸 Expense recorded!");
        }
      }
    } catch (err) {
      console.error("Error updating store:", err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Message = { id: Date.now().toString(), text: input, from: "user" };
    setMessages(prev => [...prev, userMsg]);
    setExpanded(true);
    setLoading(true);

    try {
      const response = await apiFetch("/api/v1/assistant/command/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: input.trim() }),
      }) as {
        parsed_action: string;
        confidence: number;
        message: string;
        execution_result?: any;
      };

      const aiMessage = response.message || "Command processed.";
      const action = response.parsed_action;
      const data = response.execution_result?.data || response.execution_result || {};

      // Update local store based on action
      handleApiResponse(action, data, aiMessage);

      // Add assistant response to chat
      setMessages(prev => [...prev, { 
        id: (Date.now() + 1).toString(), 
        text: aiMessage, 
        from: "assistant" 
      }]);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Error processing command. Make sure backend is running.";
      console.error("Assistant error:", err);
      toast.error(errorText);
      setMessages(prev => [...prev, { 
        id: (Date.now() + 1).toString(), 
        text: `❌ ${errorText}`, 
        from: "assistant" 
      }]);
    } finally {
      setLoading(false);
      setInput("");
    }
  };

  const handleSuggestion = (s: string) => {
    setInput(s);
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {suggestions.map(s => (
          <button
            key={s}
            onClick={() => handleSuggestion(s)}
            className="px-3 py-1.5 rounded-full bg-muted text-xs font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors whitespace-nowrap"
          >
            {s}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {expanded && messages.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-muted/30 rounded-xl p-3 space-y-2 max-h-60 overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Admin Assistant
                </span>
                <button
                  onClick={() => {
                    setExpanded(false);
                    setMessages([]);
                    onDismissAutoExpand?.();
                  }}
                  title="Close assistant"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
              {messages.map(m => (
                <div key={m.id} className={`text-sm rounded-lg px-3 py-2 ${m.from === "user" ? "bg-primary text-primary-foreground ml-8" : "bg-card mr-8"}`}>
                  <span className="whitespace-pre-line">{m.text}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-2 items-center">
        <div className="flex-1 relative">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
          <Input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            disabled={loading}
            placeholder="Try: Add 30 apples, Sold 3 loaves for R54..."
            className="pl-9 pr-4 h-11"
          />
        </div>
        <Button size="icon" onClick={handleSend} disabled={!input.trim() || loading} className="h-11 w-11 bg-gradient-hero text-primary-foreground">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
