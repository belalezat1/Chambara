import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  animate,
  motion,
  useAnimationControls,
  useMotionValue,
} from 'motion/react';

import styles from './HomeMenu.module.css';

export interface HomeMenuProps {
  onVersus: () => void;
  onPractice: () => void;
  onSettings: () => void;
  onHover: () => void;
  enterFromTitle: boolean;
}

const SVG_WIDTH = 100;
const SVG_HEIGHT = 50;

const ANIMATION_SPEED_MS = 120;

const MENU_ENTRY_DELAYS_MS = {
  VERSUS: 0,
  PRACTICE: 80,
  SETTINGS: 160,
} as const;
const MENU_INTERACTION_LOCK_MS = 560;

// Preserve the current user-tuned punch values.
const OPTION_PUNCH_DURATION_S = 0.125;
const SCENE_PUNCH_DURATION_S = 0.12;
const SCENE_PUNCH_SCALE = 1.02;

const FLASH_ACCENT_PEAK_OPACITY = 0.24;
const FLASH_ACCENT_DURATION_S = 0.09;
const FLASH_COOLDOWN_MS = 275;

const HORIZONTAL_EDGE_PADDING = 0;
const VERTICAL_EDGE_PADDING = 0;

const HORIZONTAL_CENTER_PADDING = 20;
const VERTICAL_CENTER_PADDING = 5;

const centerX = SVG_WIDTH / 2;
const centerY = SVG_HEIGHT / 2;
const w = centerX - HORIZONTAL_CENTER_PADDING;
const h = centerY - VERTICAL_CENTER_PADDING;

const createSelectorPoints = (): string => {
  const x1 = HORIZONTAL_EDGE_PADDING + Math.random() * w;
  const y1 = VERTICAL_EDGE_PADDING + Math.random() * h;

  const x2 = centerX + HORIZONTAL_CENTER_PADDING + Math.random() * w;
  const y2 = VERTICAL_EDGE_PADDING + Math.random() * h;

  const x3 = centerX + HORIZONTAL_CENTER_PADDING + Math.random() * w;
  const y3 = centerY + VERTICAL_CENTER_PADDING + Math.random() * h;

  const x4 = HORIZONTAL_EDGE_PADDING + Math.random() * w;
  const y4 = centerY + VERTICAL_CENTER_PADDING + Math.random() * h;

  return `${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}, ${x4} ${y4}`;
};

const MarqueePhrase = () => (
  <span className={styles.marqueePhrase}>
    <span className={styles.marqueeMain}>MAIN</span>
    <span className={styles.marqueeMenu}>MENU</span>
  </span>
);

interface MenuOptionProps {
  label: string;
  whiteImageSrc: string;
  blackImageSrc: string;
  className: string;
  floatClassName: string;
  onClick: () => void;
  entryDelayMs: number;
  playEntrance: boolean;
  interactionLocked: boolean;
  impactNonce: number;
  onSelect: (label: string) => void;
  onDeselect: (label: string) => void;
}

interface SelectorAnimation {
  stop: () => void;
}

const MenuOption = ({
  label,
  whiteImageSrc,
  blackImageSrc,
  className,
  floatClassName,
  onClick,
  entryDelayMs,
  playEntrance,
  interactionLocked,
  impactNonce,
  onSelect,
  onDeselect,
}: MenuOptionProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isEntering, setIsEntering] = useState(playEntrance);
  const [hasEntered, setHasEntered] = useState(!playEntrance);
  const primaryPoints = useMotionValue(createSelectorPoints());
  const blendPoints = useMotionValue(createSelectorPoints());
  const primaryAnimation = useRef<SelectorAnimation | null>(null);
  const blendAnimation = useRef<SelectorAnimation | null>(null);
  const punchControls = useAnimationControls();

  useEffect(() => {
    if (impactNonce === 0) return;

    punchControls.stop();
    punchControls.set({ x: 0, scaleX: 1 });
    void punchControls.start({
      x: [0, -20, 4, 0],
      scaleX: [1, 1.055, 0.99, 1],
      transition: {
        duration: OPTION_PUNCH_DURATION_S,
        times: [0, 0.35, 0.65, 1],
        ease: ['easeOut', 'easeInOut', 'easeOut'],
      },
    });
  }, [impactNonce, punchControls]);

  useEffect(() => {
    const stopAnimations = () => {
      primaryAnimation.current?.stop();
      blendAnimation.current?.stop();
      primaryAnimation.current = null;
      blendAnimation.current = null;
    };

    if (!isHovered) {
      stopAnimations();
      return;
    }

    const updateSelector = () => {
      primaryAnimation.current?.stop();
      blendAnimation.current?.stop();

      primaryAnimation.current = animate(
        primaryPoints,
        createSelectorPoints(),
        {
          duration: ANIMATION_SPEED_MS / 1000,
          ease: 'linear',
        },
      );

      blendAnimation.current = animate(
        blendPoints,
        createSelectorPoints(),
        {
          duration: ANIMATION_SPEED_MS / 1000,
          ease: 'linear',
        },
      );
    };

    updateSelector();
    const intervalId = window.setInterval(updateSelector, ANIMATION_SPEED_MS);

    return () => {
      window.clearInterval(intervalId);
      stopAnimations();
    };
  }, [blendPoints, isHovered, primaryPoints]);

  const entryStyle = {
    '--entry-delay': `${entryDelayMs}ms`,
  } as CSSProperties;

  return (
    <div
      className={`${styles.floatPlane} ${floatClassName} ${hasEntered ? styles.floatActive : ''}`}
    >
      <motion.div
        className={styles.punchPlane}
        initial={{ x: 0, scaleX: 1 }}
        animate={punchControls}
      >
        <button
          type="button"
          className={`${styles.menuOption} ${className} ${isEntering ? styles.entering : ''} ${interactionLocked ? styles.interactionLocked : ''}`}
          style={entryStyle}
          aria-label={label}
          onClick={() => {
            if (!interactionLocked) onClick();
          }}
          onMouseEnter={() => {
            if (interactionLocked) return;
            onSelect(label);
            setIsHovered(true);
          }}
          onMouseLeave={() => {
            setIsHovered(false);
            onDeselect(label);
          }}
          onAnimationEnd={(event) => {
            if (event.currentTarget !== event.target || !isEntering) return;
            setIsEntering(false);
            setHasEntered(true);
          }}
        >
          <svg
            className={styles.selector}
            viewBox="0 0 100 50"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <motion.polygon
              className={styles.selectorPrimary}
              points={primaryPoints}
            />
            <motion.polygon
              className={styles.selectorBlend}
              points={blendPoints}
            />
          </svg>

          <span className={styles.labelStack} aria-hidden="true">
            <img
              className={`${styles.labelImage} ${styles.labelWhite}`}
              src={whiteImageSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <img
              className={`${styles.labelImage} ${styles.labelBlack}`}
              src={blackImageSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          </span>
        </button>
      </motion.div>
    </div>
  );
};

const HomeMenu = ({
  onVersus,
  onPractice,
  onSettings,
  onHover,
  enterFromTitle,
}: HomeMenuProps) => {
  const playEntrance = useRef(enterFromTitle).current;
  const [interactionLocked, setInteractionLocked] = useState(playEntrance);
  const interactionLockedRef = useRef(playEntrance);
  const selectedOptionRef = useRef<string | null>(null);
  const impactNonceRef = useRef(0);
  const lastFlashAtRef = useRef(Number.NEGATIVE_INFINITY);
  const [selectionImpact, setSelectionImpact] = useState({ label: '', nonce: 0 });
  const sceneControls = useAnimationControls();
  const flashControls = useAnimationControls();

  useEffect(() => {
    if (!playEntrance) return;

    const unlock = () => {
      interactionLockedRef.current = false;
      setInteractionLocked(false);
    };
    const timeoutId = window.setTimeout(unlock, MENU_INTERACTION_LOCK_MS);

    return () => window.clearTimeout(timeoutId);
  }, [playEntrance]);

  const triggerFlash = () => {
    const now = performance.now();
    if (now - lastFlashAtRef.current < FLASH_COOLDOWN_MS) return;

    lastFlashAtRef.current = now;
    flashControls.stop();
    flashControls.set({ opacity: 0 });
    void flashControls.start({
      opacity: [0, FLASH_ACCENT_PEAK_OPACITY, 0],
      transition: {
        duration: FLASH_ACCENT_DURATION_S,
        times: [0, 0.28, 1],
        ease: 'linear',
      },
    });
  };

  const triggerSceneImpact = () => {
    sceneControls.stop();
    sceneControls.set({ x: 0, y: 0, scale: 1 });
    void sceneControls.start({
      x: [0, -5, 0, 0],
      y: [0, 3, -1, 0],
      scale: [1, SCENE_PUNCH_SCALE, 1, 1],
      transition: {
        duration: SCENE_PUNCH_DURATION_S,
        times: [0, 0.3, 0.65, 1],
        ease: ['easeOut', 'easeInOut', 'easeOut'],
      },
    });

    triggerFlash();
  };

  const selectOption = (label: string) => {
    if (interactionLockedRef.current || selectedOptionRef.current === label) return;

    selectedOptionRef.current = label;
    impactNonceRef.current += 1;
    setSelectionImpact({ label, nonce: impactNonceRef.current });
    onHover();
    triggerSceneImpact();
  };

  const deselectOption = (label: string) => {
    if (selectedOptionRef.current === label) {
      selectedOptionRef.current = null;
    }
  };

  const menuItems = [
    {
      label: 'VERSUS',
      whiteImageSrc: '/ui/menu/versus_w.png',
      blackImageSrc: '/ui/menu/versus_b.png',
      className: styles.versus,
      floatClassName: styles.floatVersus,
      onClick: onVersus,
      entryDelayMs: MENU_ENTRY_DELAYS_MS.VERSUS,
    },
    {
      label: 'PRACTICE',
      whiteImageSrc: '/ui/menu/practice_w.png',
      blackImageSrc: '/ui/menu/practice_b.png',
      className: styles.practice,
      floatClassName: styles.floatPractice,
      onClick: onPractice,
      entryDelayMs: MENU_ENTRY_DELAYS_MS.PRACTICE,
    },
    {
      label: 'SETTINGS',
      whiteImageSrc: '/ui/menu/setting_w.png',
      blackImageSrc: '/ui/menu/setting_b.png',
      className: styles.settings,
      floatClassName: styles.floatSettings,
      onClick: onSettings,
      entryDelayMs: MENU_ENTRY_DELAYS_MS.SETTINGS,
    },
  ];

  return (
    <div className={styles.homeMenu}>
      <motion.div
        className={styles.sceneLayer}
        initial={{ x: 0, y: 0, scale: 1 }}
        animate={sceneControls}
      >
        <div className={styles.discShell} aria-hidden="true">
          <img
            className={styles.discTexture}
            src="/ui/background_square_2.png"
            alt=""
          />
        </div>

        <img
          className={styles.foregroundArtwork}
          src="/ui/background_top_layer.png"
          alt=""
          aria-hidden="true"
        />

        <nav className={styles.menu} aria-label="Main menu">
          {menuItems.map((item) => (
            <MenuOption
              key={item.label}
              label={item.label}
              whiteImageSrc={item.blackImageSrc}
              blackImageSrc={item.whiteImageSrc}
              className={item.className}
              floatClassName={item.floatClassName}
              onClick={item.onClick}
              entryDelayMs={item.entryDelayMs}
              playEntrance={playEntrance}
              interactionLocked={interactionLocked}
              impactNonce={selectionImpact.label === item.label ? selectionImpact.nonce : 0}
              onSelect={selectOption}
              onDeselect={deselectOption}
            />
          ))}
        </nav>

        <div className={styles.marquee} aria-hidden="true">
          <div className={styles.marqueeRotator}>
            <div className={styles.marqueeTrack}>
              <div className={styles.marqueeGroup}>
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
              </div>
              <div className={styles.marqueeGroup}>
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
              </div>
              <div className={styles.marqueeGroup}>
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
                <MarqueePhrase />
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        className={styles.flashAccent}
        initial={{ opacity: 0 }}
        animate={flashControls}
        aria-hidden="true"
      />
    </div>
  );
};

export default HomeMenu;

