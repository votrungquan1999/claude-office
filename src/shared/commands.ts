import { z } from "zod";

/** Order kinds the web can give a Mac's agent. */
export enum CommandKind {
  Hire = "hire",
  Wake = "wake",
  Dismiss = "dismiss",
}

/** Where an order is in its life. */
export enum CommandStatus {
  Pending = "pending",
  Claimed = "claimed",
  Done = "done",
  Failed = "failed",
}

/** Why an order ended failed; the dialog turns each into plain words. */
export enum CommandFailReason {
  FolderMissing = "folderMissing",
  ClaudeNotFound = "claudeNotFound",
  LaunchFailed = "launchFailed",
  Interrupted = "interrupted",
  ConversationNotFound = "conversationNotFound",
  OpenElsewhere = "openElsewhere",
  CannotCheckOpen = "cannotCheckOpen",
  InvalidOrder = "invalidOrder",
}

/** An order as stored in the `commands` collection; times come from the database clock. */
export interface CommandDocument {
  _id: string;
  machineId: string;
  kind: CommandKind;
  status: CommandStatus;
  reason?: CommandFailReason;
  /** Session the order starts. */
  sessionId: string;
  folder: string;
  /** Present only until the agent claims the order. */
  firstMessage?: string;
  createdAt: Date;
  claimedAt?: Date;
  expireAt: Date;
}

/** The longest first message a hire may carry; far below the shell's argument limit. */
export const MAX_FIRST_MESSAGE_CHARS = 100_000;

/** A first message: verbatim, so an indented one keeps its indentation; only a blank or over-long one is refused. */
export const firstMessageSchema = z
  .string()
  .max(MAX_FIRST_MESSAGE_CHARS)
  .refine((message) => message.trim() !== "");

/** The owner's request to hire an employee. */
export const hireRequestSchema = z.object({
  machineId: z.string().min(1),
  folder: z.string().min(1),
  firstMessage: firstMessageSchema,
});

export type HireRequest = z.infer<typeof hireRequestSchema>;

/** The owner's request to wake a went-home or not-running employee. */
export const wakeRequestSchema = z.object({
  machineId: z.string().min(1),
  sessionId: z.string().min(1),
});

export type WakeRequest = z.infer<typeof wakeRequestSchema>;

/** The owner's request to dismiss a hired or woken employee. */
export const dismissRequestSchema = z.object({
  machineId: z.string().min(1),
  sessionId: z.string().min(1),
});

export type DismissRequest = z.infer<typeof dismissRequestSchema>;

/** What the hire, wake and dismiss routes answer: the order to follow and the session it concerns. */
export const orderResponseSchema = z.object({
  orderId: z.string(),
  sessionId: z.string(),
});

export type OrderResponse = z.infer<typeof orderResponseSchema>;

/** What the owner may read of an order; never the message. */
export const orderStatusSchema = z.object({
  status: z.enum(CommandStatus),
  reason: z.enum(CommandFailReason).optional(),
  /** Age by the database clock, so "not sent" never depends on the browser's. */
  ageMs: z.number(),
});

export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** How long an order may wait before the office calls it "not sent"; the Mac never runs an order older than this. */
export const NOT_SENT_AFTER_MS = 30_000;

/** An order nobody picks up is deleted, message included, after this long. */
export const UNCLAIMED_ORDER_TTL_MS = 600_000;
