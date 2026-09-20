import type { ReactNode } from "react";

export default function GameDebugPanel({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <aside className="hud inspector-panel" aria-label="Motion lab controls">
      {children}
    </aside>
  );
}
