import { trefoil } from "ldrs";
import { useTheme } from "@/frontend/lib/hooks/useTheme";

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

/* Picked once per page load, not per mount — a login flow can render this
   component from two different spots in a row (boot gate, then ledger
   fetch), and swapping the copy between them reads as the load restarting. */
const SESSION_MESSAGE = randomMessage();

export function LoadingBloom({ label, size = "md" }: { label?: string; size?: "sm" | "md" }) {
  const fallback = SESSION_MESSAGE;
  const { accent } = useTheme();
  return (
    <div className={`loading-bloom loading-bloom--${size}`}>
      <l-trefoil
        size={TREFOIL_SIZE[size]}
        color={accent}
        speed={5}
        stroke={8}
        stroke-length={0.4}
        bg-opacity={0.1}
      />
      <p className="loading-bloom__label">{label ?? fallback}</p>
    </div>
  );
}
