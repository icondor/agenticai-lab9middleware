// lab9/tools/email.ts
//
// Tool nou pentru tema 2: simuleaza trimiterea unui email de confirmare.
// Nu trimite nimic real, doar scrie intr-un array exportat. Array-ul e DOVADA,
// din afara conversatiei, a ce a primit EFECTIV tool-ul cand a rulat.

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const emailuriTrimise: { email: string; mesaj: string }[] = [];

export const trimiteEmailConfirmare = tool(
  async ({ email, mesaj }: { email: string; mesaj: string }) => {
    emailuriTrimise.push({ email, mesaj });
    return `Email trimis catre ${email}: "${mesaj}"`;
  },
  {
    name: "trimiteEmailConfirmare",
    description:
      "Trimite un email de confirmare clientului. Actiune ireversibila. " +
      "Exemplu intrare: { email: '[ID_EMAIL_1]', mesaj: 'Rezervarea e confirmata.' }.",
    schema: z.object({
      email: z.string().describe("Adresa de email, sau id-ul opac primit de la cautaClient."),
      mesaj: z.string().describe("Textul emailului."),
    }),
  },
);
