# Multiplayer combat QA (two laptops / two browsers)

Seat mirror, sword rebind, block stun, and match-phase sync are covered by unit
fixtures in this branch. Full PvP visual proof still needs two clients — do not
treat a single-browser lab smoke as both-screens verification.

## Publish Spacetime module (required for phase sync)

```bash
cd spacetimedb/spacetimedb
spacetime publish <your-db-name> --yes
# regenerate bindings if CLI available:
# spacetime generate --lang typescript --out-dir ../../game/src/module_bindings --module-path .
```

Without republish, seat mirror + block stun still apply from published combat
outcomes; countdown lockstep needs the new `match_phase` table/reducer.

## Two-client checklist

1. Host: Make Room → note code. Guest: Join with code.
2. Both enter Ready → Duel. Confirm both show the same countdown digits and
   enter FIGHTING together (HUD PHASE row).
3. Host hits guest: on **both** screens, defender moves outbound (toward rim),
   attacker advances toward foe. Local is always left.
4. Guest hits host: same relative motion on both screens.
5. After each connect, GripPrimary stays in front of the owning torso (not
   frozen in pre-KB world, not in the opponent’s back).
6. Block: blocker holds block → attacker enters BlockedStun for ~2.5s and is
   hittable after short i-frames. Blocker releases block → Test slash / phone
   slash connects on the stunned attacker.
7. Soft-edge then ring-out still awards the round; best-of-3 continues with
   synced countdown on the next round.

## Solo regression

```bash
cd game && npm run typecheck && npm test
# with Vite running:
node scripts/solo-hit-browser.mjs
```

`?lab=1` hit smokes must stay green.
