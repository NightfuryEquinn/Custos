import { useState } from "react";
import { trefoil } from "ldrs";
import { getAccent } from "@/frontend/lib/theme";

if (!customElements.get("l-trefoil")) {
  trefoil.register();
}

const TREFOIL_SIZE: Record<"sm" | "md", number> = { sm: 48, md: 100 };

/** Playful copy for open-ended waits (app boot, ledger fetch) — a fixed label overrides this. */
const RANDOM_MESSAGES = [
  "Preparing your ledger…",
  "Finding your budgets…",
  "Transactions inbound…",
  "Tallying your totals…",
  "Balancing the books…",
  "Counting your cents…",
  "Sorting your categories…",
  "Gathering your accounts…",
  "Crunching the numbers…",
  "Aligning your wallets…",
  "Reconciling your records…",
  "Unpacking your insights…",
  "Syncing your savings…",
  "Adding up your expenses…",
];

function randomMessage() {
  return RANDOM_MESSAGES[Math.floor(Math.random() * RANDOM_MESSAGES.length)];
}

export function LoadingBloom({ label, size = "md" }: { label?: string; size?: "sm" | "md" }) {
  const [fallback] = useState(randomMessage);
  return (
    <div className={`loading-bloom loading-bloom--${size}`}>
      <l-trefoil
        size={TREFOIL_SIZE[size]}
        // ponytail: reads the accent at mount; a theme flip mid-spinner won't repaint it.
        // Upgrade to useTheme() if that ever shows.
        color={getAccent()}
        speed={5}
        stroke={8}
        stroke-length={0.4}
        bg-opacity={0.1}
      />
      <p className="loading-bloom__label">{label ?? fallback}</p>
    </div>
  );
}
