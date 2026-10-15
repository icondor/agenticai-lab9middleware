// lab9/middleware/anonimizare.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE CUSTOM — anonimizarePii: anonimizare REVERSIBILA
// ═══════════════════════════════════════════════════════════════════════════
//
// piiMiddleware (built-in) inlocuieste PII cu un marcaj definitiv. Aici
// fiecare valoare primeste un id opac UNIC ('[ID_EMAIL_1]'), pe care il
// traducem inapoi EXACT inainte sa ruleze un tool. Modelul vede doar id-ul,
// tool-ul vede doar valoarea reala.
//
// UN SINGUR HOOK, wrapToolCall, in doua directii, in ordinea asta:
//   1. dezanonimizam argumentele venite de la model   (id opac → valoare)
//   2. chemam tool-ul real (handler)
//   3. anonimizam rezultatul tool-ului                 (valoare → id opac)
// Rezultatul MASCAT e cel care intra in istoric si pleaca spre model.

import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

type Fel = "EMAIL" | "CARD";

type Harta = {
  idLaValoare: Map<string, string>;
  valoareLaId: Map<string, string>;
  contor: Record<Fel, number>;
};

// ───────────────────────────────────────────────────────────────────────────
// Harta id opac ↔ valoare reala, per thread_id, in memoria PROCESULUI.
// ponytail: moare odata cu procesul (vezi verificarea 4 din tema2); muta-o
// intr-un store/DB pe thread_id daca agentul trebuie sa supravietuiasca unui
// restart intre intrerupere si reluare.
// ───────────────────────────────────────────────────────────────────────────
export const harti = new Map<string, Harta>();

function hartaPentru(threadId: string): Harta {
  let h = harti.get(threadId);
  if (!h) {
    h = { idLaValoare: new Map(), valoareLaId: new Map(), contor: { EMAIL: 0, CARD: 0 } };
    harti.set(threadId, h);
  }
  return h;
}

const TIPARE: [Fel, RegExp][] = [
  ["EMAIL", /[\w.+-]+@[\w-]+\.[\w.]+/g],
  // 13-16 cifre, cu spatii sau cratime optionale: 4111 1111 1111 1111
  ["CARD", /\b\d(?:[ -]?\d){12,15}\b/g],
];
const ID_OPAC = /\[ID_(EMAIL|CARD)_\d+\]/g;

/** Valoare → id opac. Aceeasi valoare primeste MEREU acelasi id pe thread. */
function anonimizeaza(text: string, h: Harta): string {
  for (const [fel, tipar] of TIPARE) {
    text = text.replace(tipar, (valoare) => {
      let id = h.valoareLaId.get(valoare);
      if (!id) {
        id = `[ID_${fel}_${++h.contor[fel]}]`;
        h.valoareLaId.set(valoare, id);
        h.idLaValoare.set(id, valoare);
      }
      return id;
    });
  }
  return text;
}

/** Id opac → valoare reala. Un id necunoscut ramane cum e. */
function dezanonimizeaza(text: string, h: Harta): string {
  return text.replace(ID_OPAC, (id) => h.idLaValoare.get(id) ?? id);
}

export function anonimizarePii() {
  return createMiddleware({
    name: "AnonimizarePii",

    wrapToolCall: async (request, handler) => {
      const threadId = request.runtime.configurable?.thread_id ?? "fara-thread";
      const h = hartaPentru(threadId);

      // 1. INAINTE: tool-ul primeste datele adevarate.
      const args = Object.fromEntries(
        Object.entries(request.toolCall.args).map(([k, v]) => [
          k,
          typeof v === "string" ? dezanonimizeaza(v, h) : v,
        ]),
      );

      // 2. Tool-ul real.
      const rezultat = await handler({ ...request, toolCall: { ...request.toolCall, args } });

      // 3. DUPA: ce intra in istoric (si ajunge la model) e mascat.
      if (ToolMessage.isInstance(rezultat) && typeof rezultat.content === "string") {
        rezultat.content = anonimizeaza(rezultat.content, h);
      }
      return rezultat;
    },
  });
}
