import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";

type LoadingScreenProps = {
  progress?: number;
  statusText?: string;
  onComplete?: () => void;
  controlled?: boolean;
  holdOpen?: boolean;
  onAssetsReady?: () => void;
};

const TIPS = [
  "LOADING FIGHTERS...",
  "SHARPENING SWORDS...",
  "WARMING UP ARENAS...",
  "CHARGING SPECIAL MOVES...",
  "PREPARING THE BATTLE...",
  "SUMMONING WARRIORS...",
];

const STARS = [
  { top: "12%", left: "18%", size: 22, delay: 0 },
  { top: "8%", left: "72%", size: 16, delay: 0.4 },
  { top: "78%", left: "14%", size: 18, delay: 0.8 },
  { top: "82%", left: "78%", size: 24, delay: 0.2 },
  { top: "45%", left: "6%", size: 14, delay: 1.1 },
  { top: "38%", left: "91%", size: 18, delay: 0.6 },
];

function Star({ size, style }: { size: number; style?: CSSProperties }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <polygon
        points="12,2 14.4,9.2 22,9.2 16,14 18.4,21.2 12,17 5.6,21.2 8,14 2,9.2 9.6,9.2"
        fill="white"
        stroke="black"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function LoadingScreen({
  progress: externalProgress,
  statusText,
  onComplete,
  controlled = false,
  holdOpen = false,
  onAssetsReady,
}: LoadingScreenProps): ReactElement | null {
  const [progress, setProgress] = useState(controlled ? externalProgress ?? 0 : 0);
  const [tipIndex, setTipIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [visible, setVisible] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const assetsReportedRef = useRef(false);
  const finishScheduledRef = useRef(false);

  const finish = () => {
    if (finishScheduledRef.current) return;
    finishScheduledRef.current = true;
    setDone(true);
    window.setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, 900);
  };

  useEffect(() => {
    if (!controlled || externalProgress === undefined) return;
    setProgress(externalProgress);
    if (externalProgress < 100) return;
    if (!assetsReportedRef.current) {
      assetsReportedRef.current = true;
      onAssetsReady?.();
    }
    if (!holdOpen) finish();
  }, [controlled, externalProgress, holdOpen, onAssetsReady]);

  useEffect(() => {
    if (controlled) return;
    intervalRef.current = setInterval(() => {
      setProgress((current) => {
        if (current >= 100) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          finish();
          return 100;
        }
        const step = current < 60 ? 1.8 : current < 85 ? 0.9 : 0.35;
        return Math.min(current + step, 100);
      });
    }, 40);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [controlled]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTipIndex((index) => (index + 1) % TIPS.length);
    }, 1900);
    return () => window.clearInterval(timer);
  }, []);

  if (!visible) return null;

  const safeProgress = Math.max(0, Math.min(progress, 100));
  const filled = Math.floor((safeProgress / 100) * 20);
  const displayTip = statusText ?? TIPS[tipIndex];

  return (
    <div className={`ui-loading-screen${done ? " is-done" : ""}`}>
      <img className="ui-loading-bg" src="/ui/loading_bg.png" alt="" aria-hidden="true" draggable={false} />
      <div className="ui-loading-vignette" aria-hidden="true" />
      {STARS.map((star, index) => (
        <div
          className="ui-loading-star"
          key={`${star.top}-${star.left}`}
          style={{
            top: star.top,
            left: star.left,
            animation: `ui-star-spin ${2.5 + index * 0.3}s ${star.delay}s linear infinite`,
          }}
        >
          <Star size={star.size} />
        </div>
      ))}

      <div className="ui-loading-card">
        <div className="ui-loading-progress-heading">
          <span>PROGRESS</span>
          <strong>{Math.floor(safeProgress)}%</strong>
        </div>
        <div className="ui-loading-bar" aria-label={`Loading ${Math.floor(safeProgress)} percent`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(safeProgress)}>
          <div className="ui-loading-fill" style={{ width: `${safeProgress}%` }} />
        </div>
        <div className="ui-loading-segments" aria-hidden="true">
          {Array.from({ length: 20 }, (_, index) => (
            <span key={index} className={index < filled ? "is-filled" : ""} />
          ))}
        </div>
        <p className="ui-loading-tip" key={displayTip}>{displayTip}</p>
      </div>
    </div>
  );
}
