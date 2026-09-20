import type { CSSProperties } from "react";

import styles from "./ScreenWipe.module.css";

export const WIPE_SWAP_MS = 190;
export const WIPE_TOTAL_MS = 600;

export default function ScreenWipe({ active }: { active: boolean }) {
  if (!active) return null;
  const style = {
    "--panel-duration": "300ms",
    "--black-start": "150ms",
    "--trailing-gold-start": "300ms",
    "--black-panel-offset": "37vw",
    "--trailing-gold-offset": "74vw",
  } as CSSProperties;

  return (
    <div className={styles.overlay} style={style} aria-hidden="true">
      <div className={`${styles.panel} ${styles.leadingGold}`} />
      <div className={`${styles.panel} ${styles.black}`} />
      <div className={`${styles.panel} ${styles.trailingGold}`} />
    </div>
  );
}
