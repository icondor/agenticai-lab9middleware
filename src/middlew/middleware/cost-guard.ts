// lab9/middleware/cost-guard.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE CUSTOM #2 — costGuard
// ═══════════════════════════════════════════════════════════════════════════
//
// CE FACE
//   Alege modelul la fiecare tura: model ieftin pentru intrebari simple,
//   model scump pentru cele complicate. Agentul nu stie ca se intampla asta.
//
// DE CE E EXEMPLUL DE BUSINESS CEL MAI DIRECT
//   Intr-un agent de suport, 70-80% din ture sunt banale: «mai are camera
//   balcon?», «la ce ora e check-in». Alea nu au nevoie de modelul de 15 dolari
//   pe milionul de tokeni de output. Diferenta de pret intre un haiku si un
//   sonnet e ~3x la input si ~3x la output. Aplicata pe 80% din trafic, aia e
//   factura injumatatita, cu acelasi cod de agent.
//
// HOOK FOLOSIT: wrapModelCall
//   Singurul hook din care poti SCHIMBA modelul. beforeModel poate schimba
//   starea, dar nu si cine e chemat. Regula de retinut:
//     vrei sa schimbi CE se trimite sau CINE primeste → wrapModelCall
//     vrei sa schimbi STAREA                          → beforeModel / afterModel
//
// CAPCANA PE CARE O DEMONSTRAM IN CLASA
//   «Simpla» se decide pe ULTIMUL mesaj de la om, nu pe toata conversatia.
//   Dupa ce ruleaza tool-urile, urmatoarea tura are in coada un ToolMessage,
//   nu o intrebare noua — deci euristica trebuie sa caute inapoi ultimul
//   HumanMessage. Daca nu faci asta, a doua tura nimereste mereu pe ramura
//   gresita. Este bug-ul clasic la middleware-urile de routing.
//
// REPARAT (tema 3)
//   1. Ieftin/scump era legat doar de PROVIDER, deci nu puteai avea haiku pe
//      Anthropic + gpt pe OpenAI cu modele alese de tine, nici doua modele pe
//      acelasi provider. Acum fiecare nivel e «provider:model» din env:
//        LLM_IEFTIN=anthropic:claude-haiku-4-5
//        LLM_SCUMP=openai:gpt-5.4
//   2. Continut ca array de blocuri (multimodal, unii provideri) era facut
//      JSON.stringify → text lung → mereu «COMPLEXA». Acum citim doar textul.
//   3. «de ce» prindea si «de cele mai multe ori». Acum cere granita de cuvant.
//   4. In demo5, auditLogger era AFARA de costGuard, deci vedea modelul
//      initial, nu pe cel ales: costul se calcula pe modelul gresit cand
//      providerul nu intoarce numele in response_metadata (ex: Gemini).
//      costGuard se pune acum inaintea lui auditLogger in lista.

import { createMiddleware } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createModel, readProviderFromEnv, type LlmProvider } from "../../lib/llm.js";

// ───────────────────────────────────────────────────────────────────────────
// Cuvintele care trag catre modelul scump. Euristica didactica, pe regex.
// In productie clasifici cu un model mic si rapid (vezi Lab 3, smart routing),
// sau te uiti la lungimea intrebarii si la numarul de tool-uri necesare.
// ───────────────────────────────────────────────────────────────────────────
const CUVINTE_GRELE =
  /compar|analiz|\bde ce\b|explica|planific|itinerar|recomand|cel mai (bun|ieftin)|avantaj|dezavantaj/i;

/** Pragul peste care o intrebare e considerata «lunga», deci probabil complexa. */
const PRAG_LUNGIME = 120;

/**
 * Decide daca intrebarea e simpla. Simpla = model ieftin.
 * Exportata separat ca s-o poti testa fara agent — un middleware testabil e un
 * middleware in care ai incredere.
 */
export function esteSimpla(text: string): boolean {
  if (text.length > PRAG_LUNGIME) return false;
  if (CUVINTE_GRELE.test(text)) return false;
  return true;
}

/**
 * Scoate textul ultimului mesaj de la om. `.text` concateneaza doar blocurile
 * de text — un JSON.stringify pe un array de blocuri ar umfla lungimea.
 */
export function ultimaIntrebareUmana(mesaje: { getType(): string; text: string }[]): string {
  for (let i = mesaje.length - 1; i >= 0; i--) {
    if (mesaje[i].getType() === "human") return mesaje[i].text;
  }
  return "";
}

type Nivel = { model: BaseChatModel; eticheta: string };

/**
 * «anthropic:claude-haiku-4-5» → model. Fara «:model», ramane modelul din env
 * al providerului (compatibil cu vechiul LLM_PROVIDER_IEFTIN).
 */
function nivelDinSpec(spec: string): Nivel {
  const [provider, model] = spec.split(":", 2) as [LlmProvider, string | undefined];
  return { model: createModel(provider, { model }), eticheta: spec };
}

/**
 * Fabrica de middleware.
 *
 * Nivelele, in ordinea prioritatii:
 *   scump  = optiuni.modelScump  | LLM_SCUMP  | LLM_PROVIDER
 *   ieftin = optiuni.modelIeftin | LLM_IEFTIN | LLM_PROVIDER_IEFTIN | = scump
 *
 * Daca ieftin nu e configurat, folosim acelasi model pentru ambele. Mecanismul
 * se vede in continuare in consola, dar economia e zero — si spunem asta
 * explicit, ca sa nu para ca demo-ul face mai mult decat face.
 */
export function costGuard(
  // Parametrii sunt optionali si servesc la TESTE: injectezi doua modele fake
  // si verifici ca middleware-ul alege ramura buna, fara sa platesti tokeni.
  optiuni: { modelIeftin?: BaseChatModel; modelScump?: BaseChatModel } = {},
) {
  // Construim modelele O SINGURA DATA, la crearea middleware-ului.
  // Daca le-ai construi in interiorul hook-ului, ai instantia un client HTTP
  // nou la fiecare tura — risipa si, la unii provideri, rate limit.
  const scump: Nivel = optiuni.modelScump
    ? { model: optiuni.modelScump, eticheta: "scump (injectat)" }
    : nivelDinSpec(process.env.LLM_SCUMP ?? readProviderFromEnv());

  const specIeftin = process.env.LLM_IEFTIN ?? process.env.LLM_PROVIDER_IEFTIN;
  const ieftin: Nivel = optiuni.modelIeftin
    ? { model: optiuni.modelIeftin, eticheta: "ieftin (injectat)" }
    : specIeftin
      ? nivelDinSpec(specIeftin)
      : scump;

  const acelasiModel = ieftin === scump;

  return createMiddleware({
    name: "CostGuard",

    wrapModelCall: async (request, handler) => {
      const simpla = esteSimpla(ultimaIntrebareUmana(request.messages));
      const ales = simpla ? ieftin : scump;

      console.log(
        `  [cost] intrebare ${simpla ? "SIMPLA" : "COMPLEXA"} → ${ales.eticheta}` +
          `${acelasiModel ? " (identic, doar demo)" : ""}`,
      );

      // Spread peste request: pastram tot (messages, tools, systemMessage,
      // state, runtime) si inlocuim doar modelul. Tool-urile se leaga de
      // modelul nou DUPA middleware, deci pot fi si provideri diferiti.
      return handler({ ...request, model: ales.model });
    },
  });
}
