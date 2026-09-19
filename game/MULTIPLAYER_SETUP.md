# Multiplayer setup (Spacetime Maincloud)

Two laptops sync sword poses and duel combat through SpacetimeDB **Maincloud**. Each phone pairs only to its own laptop (Vite `/motion-ws` relay + QR). Day-to-day you do **not** need a local `spacetime start`.

## One-time (module publish)

1. Install the [SpacetimeDB CLI](https://spacetimedb.com/install).
2. Login and publish:

```bash
export PATH="$HOME/.local/bin:$PATH"
spacetime login
cd spacetimedb
spacetime publish chambara -s maincloud -p spacetimedb -y
```

3. In `game/`: `npm install`. Defaults are already Maincloud via `game/.env`:

```
VITE_SPACETIME_URI=https://maincloud.spacetimedb.com
VITE_SPACETIME_DB=chambara
```

Dashboard: https://spacetimedb.com/chambara

## Each laptop (same steps)

```bash
cd game
npm run dev
npm run tunnel   # separate terminal — share the trycloudflare HTTPS URL
```

1. Open the **tunnel URL** in the browser (HTTPS is required for phone sensors; Maincloud uses `wss://` so match join works from that page).
2. **Phone pairing:** scan that laptop’s QR with its phone (phone rooms are independent per laptop).
3. **Laptop match:** enter the same 6-char code on both → **Join match**.

- First joiner is HOST (resolves hits / blocks / clashes / ring-outs); second is GUEST.
- STATUS should become CONNECTED; with two players, OPPONENT → SYNCED.
- Panel shows URI / DB / last OUTCOME.

## Combat (match only)

- **Block:** hold the large **HOLD TO BLOCK** zone on the phone. Sword stays vertical close to the body; tilt left/right to angle the guard. You cannot swing while holding.
- **Hit:** attacker steps in, defender knockback, then both regroup to ~2.4 m.
- **Clash:** both slash into each other → both knock back, then both step in.
- **Blocked:** correct directional guard (before the hit window) → attacker knockback + short stun.
- **Win:** soft arena rim — first push onto the edge clamps; the next outbound knockback is a **ring-out**. Round freezes (leave match to reset). No HP.

## Local Spacetime (optional debug only)

```bash
spacetime start
cd spacetimedb
spacetime publish chambara -s local -p spacetimedb -y
```

Then override in `game/.env` or the shell:

```
VITE_SPACETIME_URI=ws://127.0.0.1:3000
VITE_SPACETIME_DB=chambara
```

Do **not** mix an HTTPS tunnel page with `ws://` — browsers block that (mixed content). Use `http://localhost:5173` for local Spacetime debugging.

## Notes

- After module schema changes, regenerate bindings:

```bash
cd spacetimedb
spacetime generate -l typescript -p spacetimedb -o ../game/src/module_bindings -y
```
