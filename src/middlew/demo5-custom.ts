// lab9/demo5-custom.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// DEMO 5 — TOATE LA UN LOC: pre-built + custom, in acelasi agent
// ═══════════════════════════════════════════════════════════════════════════
//
// Rulare:  npx tsx lab9/demo5-custom.ts
//          npx tsx lab9/demo5-custom.ts "Compara vremea din Roma si Atena si
//                                        spune-mi unde sa merg"
//
// Ce se vede:
//   - costGuard alege modelul in functie de intrebare. Doua modele reale:
//       LLM_IEFTIN=anthropic:claude-haiku-4-5 LLM_SCUMP=openai:gpt-5.4 pnpm demo5
//   - auditLogger masoara si tipareste factura la final
//   - programDeLucru poate scurtcircuita totul, fara niciun apel de model
//   - toolCallLimit ramane ca plasa de siguranta
//
// Si, cel mai important: agentul in sine are exact aceleasi trei linii ca in
// demo1. Tot ce s-a adaugat sta in lista `middleware`.

import "dotenv/config";
import { createAgent, toolCallLimitMiddleware } from "langchain";
import { createModel, readProviderFromEnv } from "../lib/llm.js";
import { toolCalatorie } from "./tools/calatorie.js";
import { toolAgentie } from "./tools/agentie.js";
import { auditLogger, resetJurnal } from "./middleware/audit.js";
import { costGuard } from "./middleware/cost-guard.js";
import { programDeLucru } from "./middleware/program.js";
import type { Graph } from "@langchain/core/runnables/graph";

// Ca demo-ul sa fie previzibil in clasa, fortam o data si ora din interiorul
// programului. Comenteaza linia ca sa folosesti ora reala si arata ce se
// intampla la 22:00 — agentul raspunde fix, fara sa cheme modelul.
const ACUM_FIXAT = () => new Date("2026-09-17T11:00:00+03:00");

const agent = createAgent({
  model: createModel(readProviderFromEnv()),
  tools: [...toolCalatorie, ...toolAgentie],
  systemPrompt:
    "Esti asistentul unei agentii de turism. Raspunzi scurt, in romana.",

  middleware: [
    // Stratul cel mai de AFARA. Daca agentia e inchisa, nimic din ce urmeaza
    // nu se mai executa. Un middleware care opreste devreme trebuie pus primul,
    // altfel platesti pentru cele dinaintea lui.
    programDeLucru({ acum: ACUM_FIXAT }),

    // Decide modelul. Pus INAINTEA lui auditLogger, ca audit-ul sa vada
    // modelul ales si sa calculeze costul pe el, nu pe cel initial.
    costGuard(),

    // Masoara tot ce e mai inauntru decat el. Daca l-ai pune ultimul, n-ar
    // mai vedea ce fac middleware-urile dinaintea lui.
    auditLogger({ verbose: true }),

    // Plasa de siguranta, cel mai aproape de tool-uri.
    toolCallLimitMiddleware({ runLimit: 6, exitBehavior: "end" }),
  ] as const,
});

async function main() {
  resetJurnal();

  const intrebare =
    process.argv.slice(2).join(" ") || "Cat e ceasul in Tokyo?";

  console.log(`\n> Intrebare: ${intrebare}\n`);

  const g = (await agent.getGraphAsync()) as Graph;
  console.log("── graful complet ──");
  for (const linie of g.drawMermaid().split("\n")) {
    if (linie.includes("-->") || linie.includes("-.->")) {
      console.log("  " + linie.trim().replace(";", ""));
    }
  }
  console.log();

  const rezultat = await agent.invoke(
    { messages: [{ role: "user", content: intrebare }] },
    { recursionLimit: 25 },
  );

  const ultimul = rezultat.messages[rezultat.messages.length - 1];
  console.log(`< Raspuns: ${ultimul.content}\n`);

  // Raportul de audit se tipareste singur, din hook-ul afterAgent.
  // Exercitiu pentru sala: muta auditLogger pe prima pozitie in lista si
  // ruleaza din nou. Se schimba ceva in cifre? De ce?
}

main().catch(console.error);
