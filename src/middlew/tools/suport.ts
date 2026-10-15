// lab9/tools/suport.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// TOOL-URI PENTRU TEMA 1 — agentul de suport tehnic al unei firme SaaS
// ═══════════════════════════════════════════════════════════════════════════
//
//   1. cautaClientSuport  → intoarce date personale → piiMiddleware
//   2. escaladeazaTicket  → actiune IREVERSIBILA    → HITL (bonus)
//
// Datele sunt FALSE, in memorie, ca CLIENTI din agentie.ts.

import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Cardul e stocat DEJA doar cu ultimele 4 cifre: tool-ul nu are cum sa
// scape numarul complet, oricat de prost ar fi configurat middleware-ul.
const CLIENTI_SUPORT: Record<
  string,
  { nume: string; email: string; plan: "free" | "pro" | "enterprise"; ultimele4CifreCard: string }
> = {
  "cl-101": { nume: "Ana Radu", email: "ana.radu@example.com", plan: "pro", ultimele4CifreCard: "4242" },
  "cl-102": { nume: "Mihai Pop", email: "mihai.pop@firma.ro", plan: "free", ultimele4CifreCard: "1881" },
  "cl-103": { nume: "Elena Stan", email: "elena.stan@corp.io", plan: "enterprise", ultimele4CifreCard: "0005" },
};

export const cautaClientSuport = tool(
  async ({ idClient }: { idClient: string }) => {
    const c = CLIENTI_SUPORT[idClient.toLowerCase().trim()];
    if (!c) {
      return (
        `Nu exista clientul '${idClient}'. ` +
        `ID-uri valide: ${Object.keys(CLIENTI_SUPORT).join(", ")}.`
      );
    }
    return (
      `Client: ${c.nume} | email: ${c.email} | plan: ${c.plan} | ` +
      `card: **** **** **** ${c.ultimele4CifreCard}`
    );
  },
  {
    name: "cautaClientSuport",
    description:
      "Cauta datele unui client dupa ID: nume, email, plan (free/pro/enterprise) " +
      "si ultimele 4 cifre ale cardului. Exemplu intrare: { idClient: 'cl-101' }.",
    schema: z.object({
      idClient: z.string().describe("ID-ul clientului, format 'cl-NNN'. Ex: 'cl-101'."),
    }),
  },
);

/** Tichetele escaladate efectiv — verificabile din afara conversatiei. */
export const escaladariFacute: { idTicket: string; motiv: string }[] = [];

export const escaladeazaTicket = tool(
  async ({ idTicket, motiv }: { idTicket: string; motiv: string }) => {
    // EFECTUL IREVERSIBIL: intr-un sistem real ar pagina un om din suport.
    escaladariFacute.push({ idTicket, motiv });
    return `Tichetul ${idTicket} a fost escaladat catre om. Motiv: ${motiv}`;
  },
  {
    name: "escaladeazaTicket",
    description:
      "ESCALADEAZA un tichet catre un om din suport. Actiune ireversibila. " +
      "Foloseste-l doar daca problema e prea complicata sau clientul e nemultumit. " +
      "Exemplu intrare: { idTicket: 'T-500', motiv: 'client nemultumit' }.",
    schema: z.object({
      idTicket: z.string().describe("ID-ul tichetului. Ex: 'T-500'."),
      motiv: z.string().describe("De ce e nevoie de un om."),
    }),
  },
);

export const toolSuport = [cautaClientSuport, escaladeazaTicket];
