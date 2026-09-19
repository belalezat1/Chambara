import type { AnimationGroup } from "@babylonjs/core";

export interface AnimationPlayOptions {
  loop?: boolean;
  blendDuration?: number;
  returnToIdle?: boolean;
  /** Babylon AnimationGroup speed ratio (1 = authored rate). */
  speed?: number;
}

const LOOPING_CLIPS = new Set([
  "CombatIdle",
  "BlockIdle",
  "BlockSideLeft",
  "BlockSideRight",
]);

/** Small, name-driven controller for one imported character. */
export class AnimationController {
  private readonly groups = new Map<string, AnimationGroup>();
  private readonly idleName = "CombatIdle";
  private current = "";

  readonly discoveredNames: string[];
  readonly missingNames: string[];

  constructor(
    groups: readonly AnimationGroup[],
    expectedNames: readonly string[],
    private readonly onChange?: (name: string) => void,
  ) {
    for (const group of groups) {
      this.groups.set(group.name, group);
      group.enableBlending = true;
      group.blendingSpeed = 0.1;
    }

    this.discoveredNames = [...this.groups.keys()].sort();
    this.missingNames = expectedNames.filter((name) => !this.groups.has(name));

    if (this.missingNames.length > 0) {
      console.warn("[Chambara] Missing animation clips:", this.missingNames.join(", "));
    }
  }

  get currentName(): string {
    return this.current;
  }

  has(name: string): boolean {
    return this.groups.has(name);
  }

  play(name: string, options: AnimationPlayOptions = {}): boolean {
    const next = this.groups.get(name);
    if (!next) {
      console.warn(`[Chambara] Animation clip not found: ${name}`);
      return false;
    }

    const loop = options.loop ?? LOOPING_CLIPS.has(name);
    const blendDuration = options.blendDuration ?? 0.18;
    const blendPerFrame = Math.min(0.35, Math.max(0.025, 1 / (blendDuration * 60)));
    const speed = options.speed ?? 1;

    for (const group of this.groups.values()) {
      if (group !== next) {
        group.stop(true);
      }
    }

    next.stop(true);
    next.reset();
    next.enableBlending = true;
    next.blendingSpeed = blendPerFrame;
    next.start(loop, speed, next.from, next.to);

    this.current = name;
    this.onChange?.(name);

    if (!loop && name !== "Defeat" && options.returnToIdle !== false) {
      next.onAnimationGroupEndObservable.addOnce(() => {
        if (this.current === name) {
          this.play(this.idleName, { loop: true, blendDuration: 0.2, returnToIdle: false });
        }
      });
    }

    return true;
  }

  reset(): boolean {
    return this.play(this.idleName, { loop: true, blendDuration: 0.2, returnToIdle: false });
  }
}
