// lab9/tema3-cost-guard.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// TEMA 3 — costGuard reparat: doua modele, ales dupa intrebare
// ═══════════════════════════════════════════════════════════════════════════
//
// Rulare:  pnpm tema3   — offline, doua FakeToolCallingModel injectate.
//          pnpm tema3:real — modele reale (costa tokeni): haiku ieftin, sonnet
//            scump, cu tool-urile de calatorie si auditLogger; scrie in
//            output-tema3-real.log. Alte modele: LLM_IEFTIN / LLM_SCUMP.
//
// Un «spion» pus DUPA costGuard in lista vede request-ul deja modificat,
// deci stim sigur ce model a fost chemat, nu ce scrie in log.

import "dotenv/config";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createAgent, createMiddleware, FakeToolCallingModel, tool } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { costGuard, esteSimpla, ultimaIntrebareUmana } from "./middleware/cost-guard.js";
import { auditLogger, resetJurnal } from "./middleware/audit.js";
import { toolCalatorie } from "./tools/calatorie.js";
import { createModel, readProviderFromEnv } from "../lib/llm.js";

// Tot ce ajunge in consola (si liniile [cost]/[audit] din middleware) ajunge si in log.
const linii: string[] = [];
const consoleLog = console.log;
console.log = (...parti: unknown[]) => {
  const linie = parti.join(" ");
  consoleLog(linie);
  linii.push(linie);
};
const log = console.log;

const ping = tool(async () => "pong", { name: "ping", description: "Intoarce pong.", schema: z.object({}) });

// Fiecare tura: un tool call, apoi raspuns final. Doua ture de model per intrebare.
const ieftin = new FakeToolCallingModel({ toolCalls: [[{ name: "ping", args: {}, id: "1" }], []] });
const scump = new FakeToolCallingModel({ toolCalls: [[{ name: "ping", args: {}, id: "1" }], []] });

let chemate: string[] = [];
const spion = createMiddleware({
  name: "Spion",
  wrapModelCall: async (request, handler) => {
    chemate.push(request.model === ieftin ? "ieftin" : request.model === scump ? "scump" : "ALTUL");
    return handler(request);
  },
});

const agent = createAgent({
  model: scump,
  tools: [ping],
  middleware: [costGuard({ modelIeftin: ieftin, modelScump: scump }), spion],
});

async function main() {
  log(`# output-tema3.log — Tema 3 Lab 9, generat de src/middlew/tema3-cost-guard.ts la ${new Date().toISOString()}`);

  log("\n══ ROUTING PE AGENT (2 ture de model per intrebare: tool call + raspuns) ══\n");
  const cazuri: [string, string][] = [
    ["Cat e ceasul in Tokyo?", "ieftin"],
    ["Compara vremea din Roma si Atena si spune-mi unde sa merg", "scump"],
    ["De cele mai multe ori plec vinerea, e deschis?", "ieftin"], // «de ce» fals pozitiv, reparat
  ];
  for (const [intrebare, asteptat] of cazuri) {
    chemate = [];
    await agent.invoke({ messages: [{ role: "user", content: intrebare }] });
    log(`  "${intrebare}" → modele chemate: ${chemate.join(", ")}`);
    // A doua tura are un ToolMessage la coada: tot trebuie sa ramana pe acelasi model.
    assert.deepEqual(chemate, [asteptat, asteptat]);
  }

  log("\n══ CONTINUT CA ARRAY DE BLOCURI (bug-ul cu JSON.stringify) ══\n");
  // ~100 caractere: sub prag ca text, peste prag ca JSON (overhead-ul blocului).
  const intrebare = "Buna ziua, as vrea sa stiu cat e ceasul acum in Tokyo si la ce ora se deschide receptia hotelului.";
  const blocuri = new HumanMessage({ content: [{ type: "text", text: intrebare }] });
  const text = ultimaIntrebareUmana([blocuri]);
  const vechi = JSON.stringify(blocuri.content);
  log(`  .text           → ${text.length} caractere → ${esteSimpla(text) ? "SIMPLA" : "COMPLEXA"}`);
  log(`  JSON.stringify  → ${vechi.length} caractere → ${esteSimpla(vechi) ? "SIMPLA" : "COMPLEXA"}   (codul vechi)`);
  assert.equal(esteSimpla(text), true);
  assert.equal(esteSimpla(vechi), false);

  log("\nOK — toate verificarile au trecut.");
  writeFileSync(new URL("../../output-tema3.log", import.meta.url), linii.join("\n") + "\n");
}

// ── Rularea reala: aceleasi doua tipuri de intrebari, pe modele adevarate ──
async function mainReal() {
  log(`# output-tema3-real.log — generat de src/middlew/tema3-cost-guard.ts (REAL=1) la ${new Date().toISOString()}`);
  log(`# LLM_IEFTIN=${process.env.LLM_IEFTIN} · LLM_SCUMP=${process.env.LLM_SCUMP}`);
  const agent = createAgent({
    model: createModel(readProviderFromEnv()),
    tools: toolCalatorie,
    systemPrompt: "Esti asistentul unei agentii de turism. Raspunzi scurt, in romana.",
    // costGuard INAINTEA lui auditLogger: audit-ul vede modelul ales.
    middleware: [costGuard(), auditLogger({ verbose: true })] as const,
  });
  for (const intrebare of [
    "Cat e ceasul in Tokyo?",
    "Compara vremea din Roma si Atena si recomanda-mi unde sa merg in weekend.",
  ]) {
    resetJurnal();
    log(`\n> ${intrebare}`);
    const r = await agent.invoke({ messages: [{ role: "user", content: intrebare }] });
    log(`< ${r.messages[r.messages.length - 1].text}`);
  }
  writeFileSync(new URL("../../output-tema3-real.log", import.meta.url), linii.join("\n") + "\n");
}

(process.env.REAL === "1" ? mainReal() : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});
