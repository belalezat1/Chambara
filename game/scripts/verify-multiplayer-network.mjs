import { chromium } from "playwright";

const baseUrl = process.env.CHAMBARA_URL ?? "http://127.0.0.1:5173";
const uri = process.env.VITE_SPACETIME_URI ?? "https://maincloud.spacetimedb.com";
const database = process.env.VITE_SPACETIME_DB ?? "chambara-v4-test";
const roomCode = `T${Date.now().toString(36).toUpperCase().slice(-5)}`.slice(0, 6);

async function connect(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  return page.evaluate(async ({ uri: targetUri, database: targetDatabase }) => {
    const { DbConnection, tables } = await import("/src/module_bindings/index.ts");
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Timed out waiting for the SpacetimeDB subscription.")),
        30_000,
      );
      const finish = (callback, value) => {
        window.clearTimeout(timeout);
        callback(value);
      };
      DbConnection.builder()
        .withUri(targetUri)
        .withDatabaseName(targetDatabase)
        .onConnect((conn, identity) => {
          globalThis.__chambaraNetworkProbe = { conn, identity };
          conn.subscriptionBuilder()
            .onApplied(() => finish(resolve, identity.toHexString()))
            .onError((ctx) => finish(reject, ctx.event))
            .subscribe([
              tables.match,
              tables.matchPlayer,
              tables.swordPose,
              tables.combatIntent,
              tables.combatOutcome,
            ]);
        })
        .onConnectError((_ctx, error) => finish(reject, error))
        .build();
    });
  }, { uri, database });
}

async function call(page, reducer, args = {}) {
  await page.evaluate(async ({ reducerName, reducerArgs }) => {
    const probe = globalThis.__chambaraNetworkProbe;
    if (!probe) throw new Error("Network probe is not connected.");
    await probe.conn.reducers[reducerName](reducerArgs);
  }, { reducerName: reducer, reducerArgs: args });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    const [hostIdentity, guestIdentity] = await Promise.all([connect(host), connect(guest)]);
    await call(host, "createOrJoinMatch", { roomCode });
    await call(guest, "createOrJoinMatch", { roomCode });

    await Promise.all([
      host.waitForFunction((room) => {
        const probe = globalThis.__chambaraNetworkProbe;
        return [...probe.conn.db.matchPlayer.iter()].filter((row) => row.roomCode === room).length === 2;
      }, roomCode),
      guest.waitForFunction((room) => {
        const probe = globalThis.__chambaraNetworkProbe;
        return [...probe.conn.db.matchPlayer.iter()].filter((row) => row.roomCode === room).length === 2;
      }, roomCode),
    ]);

    await call(guest, "upsertCombatIntent", {
      blocking: false,
      slashSeq: 7,
      guardX: 0.25,
      guardY: 0.75,
    });
    await host.waitForFunction((room) => {
      const probe = globalThis.__chambaraNetworkProbe;
      return [...probe.conn.db.combatIntent.iter()].some(
        (row) => row.roomCode === room && !row.identity.equals(probe.identity) && row.slashSeq === 7,
      );
    }, roomCode);

    await host.evaluate(async (room) => {
      const probe = globalThis.__chambaraNetworkProbe;
      const opponent = [...probe.conn.db.matchPlayer.iter()].find(
        (row) => row.roomCode === room && !row.identity.equals(probe.identity),
      );
      if (!opponent) throw new Error("Host cannot resolve the opponent identity.");
      await probe.conn.reducers.publishCombatOutcome({
        seq: 1,
        kind: "hit",
        actorIdentity: probe.identity,
        targetIdentity: opponent.identity,
        playerRootX: -0.8,
        dummyRootX: 1.2,
        winnerIdentity: undefined,
      });
    }, roomCode);
    await guest.waitForFunction((room) => {
      const probe = globalThis.__chambaraNetworkProbe;
      const outcome = probe.conn.db.combatOutcome.roomCode.find(room);
      return outcome?.seq === 1 && outcome.kind === "hit";
    }, roomCode);

    console.log("RESULT_JSON", JSON.stringify({
      ok: true,
      database,
      roomCode,
      hostIdentity,
      guestIdentity,
      roster: "2/2 on both clients",
      intent: "guest slashSeq 7 received by host",
      outcome: "host hit seq 1 received by guest",
    }));
  } finally {
    await Promise.allSettled([
      call(guest, "leaveMatch"),
      call(host, "leaveMatch"),
    ]);
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
