import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CommandBox({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-lg bg-ink px-4 py-3 text-paper">
      <code className="min-w-0 flex-1 font-mono text-[0.8rem] leading-relaxed break-all">
        <span className="select-none text-paper/50">$ </span>
        {command}
      </code>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={copy}
        className="shrink-0 text-paper hover:bg-paper/10 hover:text-paper"
        aria-label={copied ? "Copied" : "Copy command"}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
