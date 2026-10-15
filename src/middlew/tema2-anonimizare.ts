// lab9/tema2-anonimizare.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// TEMA 2 — MIDDLEWARE CUSTOM: ANONIMIZARE REVERSIBILA
// ═══════════════════════════════════════════════════════════════════════════
//
// Rulare:  pnpm tema2   (sau: npx tsx src/middlew/tema2-anonimizare.ts)
//          NU consuma tokeni, NU are nevoie de cheie de API.
//          Scrie tot ce apare in consola si in output-tema2.log.
//
// FakeToolCallingModel NU citeste rezultatele tool-urilor, reda un script
// fix. De aceea '[ID_EMAIL_1]' e scris de mana mai jos; un model real l-ar
// copia singur din ToolMessage-ul lui cautaClient.
//
// REAL=1 (pnpm tema2:real): acelasi script cu modelul din .env (LLM_PROVIDER),
// in locul celui fals; turele scrise pentru modelul fals sunt ignorate.
// Scrie in output-tema2-real.log, fara sectiunea RASPUNSURI (aceea citeaza rularea falsa).

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createAgent, FakeToolCallingModel, humanInTheLoopMiddleware } from "langchain";
import { Command, MemorySaver } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { createModel, readProviderFromEnv } from "../lib/llm.js";
import { cautaClient } from "./tools/agentie.js";
import { emailuriTrimise, trimiteEmailConfirmare } from "./tools/email.js";
import { anonimizarePii, harti } from "./middleware/anonimizare.js";

const REAL = process.env.REAL === "1";
const model = (fals: FakeToolCallingModel) => (REAL ? createModel(readProviderFromEnv()) : fals);

// Doar pentru modelul real (cel fals l-ar ecoua in fiecare raspuns): il
// impinge sa foloseasca tool-urile in loc sa ceara confirmari.
const SYSTEM =
  "Esti asistentul unei agentii de turism. Cand ai nevoie de emailul clientului, folosesti exact valoarea intoarsa de cautaClient. Folosesti tool-urile direct, fara sa ceri confirmare. Raspunzi scurt, in romana.";

// Tot ce ajunge in consola (si liniile [cost]/[audit] din middleware) ajunge si in log.
const linii: string[] = [];
const consoleLog = console.log;
console.log = (...parti: unknown[]) => {
  const linie = parti.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  consoleLog(linie);
  linii.push(linie);
};
const log = console.log;

// Mesajele [ai] ale modelului fals ecoueaza tot istoricul; aratam doar
// tool call-urile lor, restul e zgomot.
function afiseaza(mesaje: BaseMessage[]) {
  for (const m of mesaje) {
    const calls = (m as any).tool_calls as { name: string; args: unknown }[] | undefined;
    if (m.getType() === "ai") {
      log("[ai]", calls?.length ? calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ") : "(raspuns final, fara tool calls)");
    } else {
      log(`[${m.getType()}]`, m.content);
    }
  }
}

const harta = (threadId: string) => JSON.stringify([...(harti.get(threadId)?.idLaValoare ?? [])]);
const caut = (idClient: string, id: string) => ({ name: "cautaClient", args: { idClient }, id });
const trimite = (email: string, id: string) => ({
  name: "trimiteEmailConfirmare",
  args: { email, mesaj: "Rezervarea ta e confirmata." },
  id,
});

// ── 1 + 2. ID opac in istoric, valoare reala in tool ──────────────────────
async function verificare1si2() {
  log("\n══ VERIFICAREA 1 + 2 — cautaClient, apoi trimiteEmailConfirmare cu id-ul opac ══\n");
  const agent = createAgent({
    systemPrompt: REAL ? SYSTEM : undefined,
    model: model(new FakeToolCallingModel({
      toolCalls: [[caut("ionel.popescu", "c1")], [trimite("[ID_EMAIL_1]", "c2")], []],
    })),
    tools: [cautaClient, trimiteEmailConfirmare],
    middleware: [anonimizarePii()],
  });
  const r = await agent.invoke(
    { messages: [{ role: "user", content: "gaseste-l pe ionel.popescu si trimite-i confirmarea" }] },
    { configurable: { thread_id: "t-1" } },
  );
  afiseaza(r.messages);
  log(`\nHarta thread t-1: ${harta("t-1")}`);
  log(`emailuriTrimise (populat de tool, din afara conversatiei): ${JSON.stringify(emailuriTrimise)}`);
}

// ── 3. Acelasi client de doua ori pe acelasi thread ───────────────────────
async function verificare3() {
  log("\n══ VERIFICAREA 3 — ionel.popescu de DOUA ori (plus maria.ionescu) pe acelasi thread ══\n");
  const agent = createAgent({
    systemPrompt: REAL ? SYSTEM : undefined,
    model: model(new FakeToolCallingModel({
      toolCalls: [[caut("ionel.popescu", "c1")], [caut("ionel.popescu", "c2")], [caut("maria.ionescu", "c3")], []],
    })),
    tools: [cautaClient],
    middleware: [anonimizarePii()],
  });
  const r = await agent.invoke(
    { messages: [{ role: "user", content: "cauta ionel.popescu de doua ori, apoi maria.ionescu" }] },
    { configurable: { thread_id: "t-3" } },
  );
  afiseaza(r.messages);
  log(`\nHarta thread t-3: ${harta("t-3")}`);
  log(`Harta thread t-1: ${harta("t-1")}   (separata: acelasi id poate insemna altceva pe alt thread)`);
}

// ── 4. HITL + procesul moare intre intrerupere si aprobare ────────────────
async function verificare4() {
  log("\n══ VERIFICAREA 4 — alaturi de HITL, procesul «moare» inainte de aprobare ══\n");
  emailuriTrimise.length = 0;
  // Checkpointer-ul il pastram intre «procese», ca si cum ar fi durabil
  // (Postgres/SQLite). Harta din memorie NU o pastram.
  const checkpointer = new MemorySaver();
  const config = { configurable: { thread_id: "t-4" } };
  const agent = createAgent({
    systemPrompt: REAL ? SYSTEM : undefined,
    model: model(new FakeToolCallingModel({ toolCalls: [[caut("ionel.popescu", "c1")], [trimite("[ID_EMAIL_1]", "c2")], []] })),
    tools: [cautaClient, trimiteEmailConfirmare],
    middleware: [
      anonimizarePii(),
      humanInTheLoopMiddleware({
        interruptOn: { trimiteEmailConfirmare: { allowedDecisions: ["approve", "reject"] } },
      }),
    ],
    checkpointer,
  });

  const r1: any = await agent.invoke(
    { messages: [{ role: "user", content: "gaseste-l pe ionel.popescu si trimite-i confirmarea" }] },
    config,
  );
  const cerere = r1.__interrupt__?.[0]?.value;
  log(`→ INTRERUPERE: ${cerere?.actionRequests[0].name} ${JSON.stringify(cerere?.actionRequests[0].args)}`);
  log(`Harta thread t-4 inainte de «crash»: ${harta("t-4")}`);

  harti.clear(); // procesul a murit; checkpointer-ul (durabil) a supravietuit
  log(`Harta thread t-4 dupa «restart»:     ${harta("t-4")}`);

  const r2: any = await agent.invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config);
  log("→ approve, reluare:");
  afiseaza(r2.messages.slice(-2));
  log(`emailuriTrimise dupa reluare: ${JSON.stringify(emailuriTrimise)}`);
}

// Raspunsurile la lista de verificare. Extrasele sunt copiate din consola
// unei rulari reale; rularea e determinista (model fals), deci raman valabile.
const RASPUNSURI = `
══════════════════════════════════════════════════════════════════════
 RASPUNSURI (extrase copiate exact din consola de mai sus)
══════════════════════════════════════════════════════════════════════

1. ToolMessage-ul lui cautaClient contine id-uri opace, nu datele reale:
     [tool] Client Ionel Popescu | email: [ID_EMAIL_1] | card: [ID_CARD_1] | oras: Cluj-Napoca
   Pe aceeasi cale si cardul (4111 1111 1111 1111) ajunge [ID_CARD_1].

2. Modelul a cerut:  trimiteEmailConfirmare({"email":"[ID_EMAIL_1]",...})
   Tool-ul a primit EFECTIV (array-ul populat de tool, nu mesajele):
     emailuriTrimise (populat de tool, din afara conversatiei): [{"email":"ionel.popescu@example.com","mesaj":"Rezervarea ta e confirmata."}]
   Iar in istoric, confirmarea tool-ului e mascata la loc:
     [tool] Email trimis catre [ID_EMAIL_1]: "Rezervarea ta e confirmata."

3. ACELASI id. Ambele cautari ale lui ionel.popescu intorc:
     [tool] Client Ionel Popescu | email: [ID_EMAIL_1] | card: [ID_CARD_1] | oras: Cluj-Napoca
   iar maria.ionescu primeste id-uri noi: [ID_EMAIL_2] / [ID_CARD_2].
   E corect sa fie acelasi: modelul poate recunoaste ca e aceeasi persoana, harta nu
   creste la nesfarsit, iar un id vechi din istoric ramane valid. Garantia in cod e
   harta inversa valoareLaId (per thread), consultata INAINTE de a aloca un id nou:
     let id = h.valoareLaId.get(valoare);
     if (!id) { id = \`[ID_\${fel}_\${++h.contor[fel]}]\`; ... }
   Harta e per thread_id: pe t-1 si pe t-3 [ID_EMAIL_1] exista separat, deci un
   id dintr-o conversatie nu se poate rezolva in alta.

4. Harta traieste in memoria PROCESULUI; tool call-ul in asteptare (cu
   "[ID_EMAIL_1]" in args) traieste in CHECKPOINTER, pe thread_id. Simulat:
     Harta thread t-4 inainte de «crash»: [["[ID_EMAIL_1]","ionel.popescu@example.com"],...]
     Harta thread t-4 dupa «restart»:     []
     emailuriTrimise dupa reluare: [{"email":"[ID_EMAIL_1]","mesaj":"Rezervarea ta e confirmata."}]
   Dupa restart, acelasi thread_id reia corect din checkpoint si omul aproba, dar
   dezanonimizarea nu mai gaseste id-ul si il lasa cum e: tool-ul IREVERSIBIL ruleaza
   cu "[ID_EMAIL_1]" ca adresa. Fara eroare, fara avertisment.
   (Cu MemorySaver ar muri si checkpoint-ul, deci nu s-ar putea relua deloc; riscul real
   apare exact cand pui un checkpointer durabil, Postgres/SQLite, cum cere productia.)
   Remedii: harta trebuie sa traiasca acolo unde traieste checkpoint-ul si cu aceeasi
   cheie (thread_id): in state-ul agentului (stateSchema, persistat de checkpointer)
   sau intr-un store durabil pe thread_id, criptat, pentru ca acolo sunt PII in clar.
   Plus o plasa de siguranta: daca dupa dezanonimizare in args mai exista un
   [ID_...], refuzi executia tool-ului in loc sa-l rulezi.`;

async function main() {
  log(`# ${REAL ? "output-tema2-real.log (REAL=1)" : "output-tema2.log"} — Tema 2 Lab 9, generat de src/middlew/tema2-anonimizare.ts la ${new Date().toISOString()}`);
  await verificare1si2();
  await verificare3();
  await verificare4();
  if (!REAL) log(RASPUNSURI);
  writeFileSync(new URL(`../../${REAL ? "output-tema2-real.log" : "output-tema2.log"}`, import.meta.url), linii.join("\n") + "\n");
  console.log(`\n(scris in ${REAL ? "output-tema2-real.log" : "output-tema2.log"})`);
}

main().catch(console.error);
