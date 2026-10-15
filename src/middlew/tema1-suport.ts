// lab9/tema1-suport.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// TEMA 1 — AGENT DE SUPORT TEHNIC (PII + limita de tool calls + HITL bonus)
// ═══════════════════════════════════════════════════════════════════════════
//
// Rulare:  pnpm tema1   (sau: npx tsx src/middlew/tema1-suport.ts)
//          NU consuma tokeni, NU are nevoie de cheie de API.
//          Scrie tot ce apare in consola si in output.log (root-ul proiectului).
//
// Fiecare verificare are propriul FakeToolCallingModel: modelul fals tine un
// contor de ture PE INSTANTA, deci o instanta refolosita ar continua de unde
// a ramas scenariul anterior.
//
// REAL=1 (pnpm tema1:real): acelasi script cu modelul din .env (LLM_PROVIDER),
// in locul celui fals; turele scrise pentru modelul fals sunt ignorate.
// Scrie in output-tema1-real.log, fara sectiunea RASPUNSURI (aceea citeaza rularea falsa).

import "dotenv/config";
import { writeFileSync } from "node:fs";
import {
  createAgent,
  FakeToolCallingModel,
  humanInTheLoopMiddleware,
  piiMiddleware,
  toolCallLimitMiddleware,
} from "langchain";
import { Command, MemorySaver } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { createModel, readProviderFromEnv } from "../lib/llm.js";
import { cautaClientSuport, escaladeazaTicket, escaladariFacute, toolSuport } from "./tools/suport.js";

const REAL = process.env.REAL === "1";
const model = (fals: FakeToolCallingModel) => (REAL ? createModel(readProviderFromEnv()) : fals);

// Doar pentru modelul real (cel fals l-ar ecoua in fiecare raspuns): il
// impinge sa foloseasca tool-urile in loc sa ceara confirmari.
const SYSTEM =
  "Esti agentul de suport tehnic al unei firme SaaS. Folosesti tool-urile direct, fara sa ceri confirmare. Raspunzi scurt, in romana.";

// Tot ce ajunge in consola (si liniile [cost]/[audit] din middleware) ajunge si in log.
const linii: string[] = [];
const consoleLog = console.log;
console.log = (...parti: unknown[]) => {
  const linie = parti.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  consoleLog(linie);
  linii.push(linie);
};
const log = console.log;

function afiseaza(mesaje: BaseMessage[]) {
  for (const m of mesaje) log(`[${m.getType()}]`, m.content);
}

const cautaCall = (idClient: string, id: string) => ({ name: "cautaClientSuport", args: { idClient }, id });
const escaladeazaCall = (id: string) => ({
  name: "escaladeazaTicket",
  args: { idTicket: "T-500", motiv: "clientul e nemultumit de facturare" },
  id,
});

// Middleware-ul obligatoriu, identic in toate scenariile.
const middlewareObligatoriu = () => [
  piiMiddleware("email", { strategy: "mask", applyToToolResults: true }),
  toolCallLimitMiddleware({ runLimit: 3, exitBehavior: "end" }),
] as const;

const hitl = () =>
  humanInTheLoopMiddleware({
    interruptOn: { escaladeazaTicket: { allowedDecisions: ["approve", "reject"] } },
  });

// ── 1. PII ────────────────────────────────────────────────────────────────
async function verificare1() {
  log("\n══ VERIFICAREA 1 — piiMiddleware pe rezultatul lui cautaClientSuport ══\n");
  const agent = createAgent({
    systemPrompt: REAL ? SYSTEM : undefined,
    model: model(new FakeToolCallingModel({ toolCalls: [[cautaCall("cl-101", "1")], []] })),
    tools: [cautaClientSuport],
    middleware: middlewareObligatoriu(),
  });
  const r = await agent.invoke({
    messages: [{ role: "user", content: "cauta clientul cl-101, vreau sa vad planul lui" }],
  });
  afiseaza(r.messages);
}

// ── 2. 4 tool call-uri la rand, runLimit 3 ────────────────────────────────
async function verificare2() {
  log("\n══ VERIFICAREA 2 — 4 tool call-uri la rand, runLimit: 3, exitBehavior: 'end' ══\n");
  const agent = createAgent({
    systemPrompt: REAL ? SYSTEM : undefined,
    model: model(new FakeToolCallingModel({
      toolCalls: [
        [cautaCall("cl-101", "1")],
        [cautaCall("cl-102", "2")],
        [cautaCall("cl-103", "3")],
        [cautaCall("cl-101", "4")],
        [],
      ],
    })),
    tools: [cautaClientSuport],
    middleware: middlewareObligatoriu(),
  });
  try {
    const r = await agent.invoke({
      messages: [{ role: "user", content: "cauta pe rand clientii cl-101, cl-102, cl-103 si apoi iar cl-101, cate unul pe rand" }],
    });
    afiseaza(r.messages);
    const toolMsgs = r.messages.filter((m: BaseMessage) => m.getType() === "tool").length;
    log(`\n→ invoke() s-a terminat FARA exceptie. ToolMessage-uri in istoric: ${toolMsgs}`);
  } catch (e) {
    log(`\n→ EXCEPTIE: ${(e as Error).message}`);
  }
}

// ── 3. Intrebarea capcana (raspuns scris, nu cod) ─────────────────────────
function verificare3() {
  log("\n══ VERIFICAREA 3 — runLimit vs threadLimit (raspuns) ══\n");
  log(
    "Niciunul nu e suficient singur. runLimit se reseteaza la fiecare invoke(), iar threadLimit\n" +
      "numara per thread_id (o singura conversatie, tinuta in checkpointer): un client care deschide\n" +
      "10 conversatii separate primeste 10 thread-uri noi, fiecare cu contorul de la zero.\n" +
      "Cerinta e legata de CLIENT, peste thread-uri, deci cere stare persistenta per idClient\n" +
      "(un contor intr-un store/DB, verificat de un middleware custom sau chiar in tool).\n" +
      "runLimit-ul nostru acopera doar cerinta de cost/latenta din management (nu cauta acelasi\n" +
      "client de zeci de ori intr-o rulare), nu si cerinta 'nu suna de 10 ori pentru aceeasi problema'.",
  );
}

// ── 4. HITL fara checkpointer ─────────────────────────────────────────────
async function verificare4() {
  log("\n══ VERIFICAREA 4 — humanInTheLoopMiddleware FARA checkpointer ══\n");
  const agent = createAgent({
    systemPrompt: REAL ? SYSTEM : undefined,
    model: model(new FakeToolCallingModel({ toolCalls: [[escaladeazaCall("1")], []] })),
    tools: toolSuport,
    middleware: [...middlewareObligatoriu(), hitl()] as const,
    // checkpointer: lipseste intentionat
  });
  try {
    const r: any = await agent.invoke({
      messages: [{ role: "user", content: "escaladeaza tichetul T-500, clientul cl-101 e foarte nemultumit de facturare" }],
    });
    log(`→ fara exceptie. __interrupt__: ${r.__interrupt__ ? "DA" : "nu"}`);
    afiseaza(r.messages);
  } catch (e) {
    log(`→ EROARE (${(e as Error).name}): ${(e as Error).message}`);
  }
  log(`escaladariFacute dupa verificarea 4: ${JSON.stringify(escaladariFacute)}`);
}

// ── 5. Acelasi thread_id vs thread_id diferit ─────────────────────────────
async function verificare5() {
  log("\n══ VERIFICAREA 5 — acelasi thread_id vs thread_id diferit ══\n");
  const checkpointer = new MemorySaver(); // comun tuturor rularilor, ca intr-un server real

  // `start` = de la ce tura porneste modelul fals. FakeToolCallingModel da
  // AIMessage-urilor id = numarul turei ("0", "1"...); pe acelasi thread, un
  // mesaj nou cu id refolosit l-ar SUPRASCRIE pe cel vechi (reducerul de
  // mesaje face upsert dupa id). Artefact de model fals, nu de middleware.
  async function flux(threadId: string, eticheta: string, start = 0) {
    log(`\n── ${eticheta} (thread_id: "${threadId}") ──`);
    const toolCalls: any[][] = Array.from({ length: start }, () => []);
    toolCalls.push([escaladeazaCall(`e${start}`)], []);
    const agent = createAgent({
      systemPrompt: REAL ? SYSTEM : undefined,
      model: model(new FakeToolCallingModel({ toolCalls, index: start })),
      tools: toolSuport,
      middleware: [...middlewareObligatoriu(), hitl()] as const,
      checkpointer,
    });
    const config = { configurable: { thread_id: threadId } };
    const r1: any = await agent.invoke(
      { messages: [{ role: "user", content: "escaladeaza tichetul T-500, clientul cl-101 e foarte nemultumit de facturare" }] },
      config,
    );
    log(`mesaje in istoric la intrerupere: ${r1.messages.length}`);
    if (!r1.__interrupt__) {
      log("→ NU s-a cerut aprobare");
      afiseaza(r1.messages);
      return;
    }
    const cerere = r1.__interrupt__[0].value;
    log(`→ INTRERUPERE, se cere aprobare pentru: ${cerere.actionRequests[0].name} ${JSON.stringify(cerere.actionRequests[0].args)}`);
    const r2: any = await agent.invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config);
    log(`→ approve. Mesaje in istoric dupa reluare: ${r2.messages.length}`);
    afiseaza(r2.messages);
    log(`escaladariFacute: ${escaladariFacute.length} ${JSON.stringify(escaladariFacute)}`);
  }

  await flux("t-A", "Rularea 1");
  await flux("t-A", "Rularea 2, ACELASI thread_id", 2);
  await flux("t-B", "Rularea 3, thread_id DIFERIT");
}

// Raspunsurile la lista de verificare. Extrasele sunt copiate din consola
// unei rulari reale; rularea e determinista (model fals), deci raman valabile.
const RASPUNSURI = `
══════════════════════════════════════════════════════════════════════
 RASPUNSURI (extrase copiate exact din consola de mai sus)
══════════════════════════════════════════════════════════════════════

1. ToolMessage-ul din istoric are emailul MASCAT de piiMiddleware:
     [tool] Client: Ana Radu | email: a***@example.com | plan: pro | card: **** **** **** 4242
   Emailul in clar "ana.radu@example.com" nu apare nicaieri in output. Cardul nu e
   treaba middleware-ului: tool-ul stocheaza si intoarce doar ultimele 4 cifre.
   Merge si pe celelalte domenii: "m***@firma.ro", "e***@corp.io".

2. Primele 3 apeluri se executa normal. Al 4-lea NU se executa, e inlocuit cu:
     [tool] Tool call limit exceeded. Do not make additional tool calls.
     [ai] Tool call limit reached: run limit exceeded (4/3 calls).
     → invoke() s-a terminat FARA exceptie. ToolMessage-uri in istoric: 4
   (al 4-lea ToolMessage e cel de eroare, nu rezultatul lui cl-101). Oprire eleganta
   cu exitBehavior: "end", fara exceptie.

3. Vezi sectiunea VERIFICAREA 3 de mai sus.

4. Fara checkpointer, agent.invoke() arunca:
     → EROARE (GraphValueError): No checkpointer set
     Troubleshooting URL: https://docs.langchain.com/oss/javascript/langgraph/MISSING_CHECKPOINTER/
   Tool-ul NU s-a executat: "escaladariFacute dupa verificarea 4: []".

5. ACELASI thread_id ("t-A"), dupa ce prima escaladare a fost aprobata:
     mesaje in istoric la intrerupere: 6      (fata de 2 la prima rulare)
     → approve. Mesaje in istoric dupa reluare: 8
   Conversatia continua peste istoricul vechi (primul human/ai/tool/ai sunt inca acolo).
   thread_id DIFERIT ("t-B"):
     mesaje in istoric la intrerupere: 2
     → approve. Mesaje in istoric dupa reluare: 4
   Porneste de la zero, fara istoric. In AMBELE cazuri HITL cere din nou aprobare:
   aprobarea e per tool call, nu se "tine minte" pe thread. Tichetul T-500 a ajuns
   escaladat de 3 ori ("escaladariFacute: 3"), deci nici HITL, nici thread-ul nu
   previn dubla escaladare. Pentru asta ar trebui ca tool-ul sa fie idempotent (sa verifice
   daca idTicket e deja in escaladariFacute).
   Nota: FakeToolCallingModel da AIMessage-urilor id-ul "0", "1"... dupa tura. Pe acelasi
   thread, id-urile refolosite suprascriau mesajele vechi (upsert dupa id), de aceea
   rularea 2 porneste modelul fals de la tura 2 (vezi comentariul din verificare5).`;

async function main() {
  log(`# ${REAL ? "output-tema1-real.log (REAL=1)" : "output.log"} — Tema 1 Lab 9, generat de src/middlew/tema1-suport.ts la ${new Date().toISOString()}`);
  await verificare1();
  await verificare2();
  verificare3();
  await verificare4();
  await verificare5();
  if (!REAL) log(RASPUNSURI);
  writeFileSync(new URL(`../../${REAL ? "output-tema1-real.log" : "output.log"}`, import.meta.url), linii.join("\n") + "\n");
  console.log(`\n(scris in ${REAL ? "output-tema1-real.log" : "output.log"})`);
}

main().catch(console.error);
