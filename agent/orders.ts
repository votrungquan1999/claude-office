import { z } from "zod";
import { CommandKind, firstMessageSchema } from "../src/shared/commands";

/** Session ids are UUIDs; the shape also keeps them out of file names and shell words. */
const sessionIdSchema = z.guid();

/** A folder the Mac is asked to open: an absolute path, so a relative one never resolves against the agent's own folder. */
const folderSchema = z.string().startsWith("/");

/** What a hire order must hold before the agent acts on it. */
export const hireOrderSchema = z.object({
  kind: z.literal(CommandKind.Hire),
  sessionId: sessionIdSchema,
  folder: folderSchema,
  firstMessage: firstMessageSchema,
});

export type HireOrder = z.infer<typeof hireOrderSchema>;

/** What a wake order must hold; the folder it carries is not used, the Mac resumes in the folder it stored for the conversation. */
export const wakeOrderSchema = z.object({
  kind: z.literal(CommandKind.Wake),
  sessionId: sessionIdSchema,
});

export type WakeOrder = z.infer<typeof wakeOrderSchema>;

/** Order kinds this agent knows; the claim never takes any other. */
export const KNOWN_ORDER_KINDS: CommandKind[] = [
  CommandKind.Hire,
  CommandKind.Wake,
];

/** Any order the agent can run. */
export const orderSchema = z.discriminatedUnion("kind", [
  hireOrderSchema,
  wakeOrderSchema,
]);

export type Order = z.infer<typeof orderSchema>;
