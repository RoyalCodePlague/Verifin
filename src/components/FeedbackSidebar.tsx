import { useMemo, useState } from "react";
import { Lightbulb, MessageSquarePlus, ThumbsUp } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { createFeedbackApi, listFeedbackApi, toggleFeedbackUpvoteApi, type FeedbackItem } from "@/lib/api";

type FeedbackSidebarProps = {
  triggerClassName?: string;
  triggerLabel?: string;
  onTriggerClick?: () => void;
};

const categories: Array<{ value: FeedbackItem["category"]; label: string }> = [
  { value: "idea", label: "Idea" },
  { value: "bug", label: "Bug" },
  { value: "improvement", label: "Improve" },
  { value: "praise", label: "Praise" },
];

export function FeedbackSidebar({ triggerClassName, triggerLabel = "Feedback", onTriggerClick }: FeedbackSidebarProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<FeedbackItem["category"]>("idea");

  const feedbackQuery = useQuery({
    queryKey: ["feedback"],
    queryFn: listFeedbackApi,
    enabled: open,
    refetchInterval: open ? 20000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: open,
  });

  const sortedFeedback = useMemo(() => {
    return [...(feedbackQuery.data || [])].sort((a, b) => {
      if (b.upvote_count !== a.upvote_count) return b.upvote_count - a.upvote_count;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [feedbackQuery.data]);

  const createMutation = useMutation({
    mutationFn: createFeedbackApi,
    onSuccess: () => {
      setTitle("");
      setMessage("");
      setCategory("idea");
      toast.success("Feedback posted");
      void queryClient.invalidateQueries({ queryKey: ["feedback"] });
    },
    onError: () => toast.error("Could not post feedback right now."),
  });

  const upvoteMutation = useMutation({
    mutationFn: toggleFeedbackUpvoteApi,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["feedback"] }),
    onError: () => toast.error("Could not update that vote."),
  });

  const submitFeedback = () => {
    const nextTitle = title.trim();
    const nextMessage = message.trim();
    if (!nextTitle || !nextMessage) {
      toast.warning("Add a title and a few details first.");
      return;
    }
    createMutation.mutate({ title: nextTitle, message: nextMessage, category });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          onClick={onTriggerClick}
          className={triggerClassName || "inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"}
        >
          <MessageSquarePlus className="h-4 w-4" />
          <span>{triggerLabel}</span>
        </button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2 font-display">
            <Lightbulb className="h-5 w-5 text-primary" />
            Feedback
          </SheetTitle>
          <SheetDescription>Share ideas, bugs, and improvements with everyone using the app.</SheetDescription>
        </SheetHeader>

        <div className="border-b border-border px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            {categories.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setCategory(item.value)}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  category === item.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Input className="mt-3" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Short title" />
          <Textarea className="mt-3 min-h-24" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What should we know?" />
          <Button className="mt-3 w-full" onClick={submitFeedback} disabled={createMutation.isPending}>
            Post feedback
          </Button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {feedbackQuery.isFetching && !feedbackQuery.isLoading && (
            <p className="text-xs font-medium text-muted-foreground">Checking for new feedback...</p>
          )}
          {feedbackQuery.isLoading && <p className="text-sm text-muted-foreground">Loading feedback...</p>}
          {feedbackQuery.isError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Feedback could not be loaded.</p>}
          {!feedbackQuery.isLoading && sortedFeedback.length === 0 && (
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">No feedback yet. Start the board.</p>
          )}
          {sortedFeedback.map((item) => (
            <article key={item.id} className="rounded-lg border border-border bg-card p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">{item.category}</span>
                  <h3 className="mt-2 text-sm font-semibold leading-tight">{item.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => upvoteMutation.mutate(item.id)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
                    item.has_upvoted ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  title={item.has_upvoted ? "Remove upvote" : "Upvote"}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  {item.upvote_count}
                </button>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.message}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {item.author_name} | {new Date(item.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
              </p>
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
