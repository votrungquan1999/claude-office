import { z } from "zod";

/** The few `tool_input` keys step text needs; any other key (command, content, ...) is stripped on parse. */
export const reducedToolInputSchema = z.object({
  description: z.string().optional(),
  file_name: z.string().optional(),
  pattern: z.string().optional(),
  query: z.string().optional(),
  domain: z.string().optional(),
  activeTodo: z.string().optional(),
  run_in_background: z.boolean().optional(),
});

/**
 * One hook event as the hook script forwards it. `z.object` drops unknown keys, so command text,
 * tool output, error text and notification text cannot be held even if a sender includes them.
 */
export const hookEventSchema = z.object({
  hook_event_name: z.string().min(1),
  session_id: z.string().min(1),
  hookTs: z.number(),
  cwd: z.string().optional(),
  bridgeSessionId: z.string().optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  duration_ms: z.number().optional(),
  is_interrupt: z.boolean().optional(),
  notification_type: z.string().optional(),
  reason: z.string().optional(),
  source: z.string().optional(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  prompt: z.string().max(500).optional(),
  session_title: z.string().optional(),
  tool_input: reducedToolInputSchema.optional(),
});

export type HookEvent = z.infer<typeof hookEventSchema>;
