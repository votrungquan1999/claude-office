import { z } from "zod";

/** A start folder of one Mac as the office API sends it. */
export const folderDtoSchema = z.object({
  machineId: z.string(),
  path: z.string(),
  /** Whether the folder groups its sub-folders into one company. */
  companyMode: z.boolean(),
  /** Whether the folder is still on the Mac; absent until the agent first checks. */
  existsOnMac: z.boolean().optional(),
  /** Whether Claude Code trusts the folder; absent when the Mac cannot tell. */
  cliTrusted: z.boolean().optional(),
  /** The owner's name for the company; absent means the folder name. */
  displayName: z.string().optional(),
});

export type FolderDto = z.infer<typeof folderDtoSchema>;

/** The owner's request to switch company mode on or off for one folder of one Mac. */
export const setCompanyModeRequestSchema = z.object({
  machineId: z.string().min(1),
  path: z.string().min(1),
  companyMode: z.boolean(),
});

export type SetCompanyModeRequest = z.infer<typeof setCompanyModeRequestSchema>;

/** The owner's request to name a company, or to put its folder name back with a blank or null name. */
export const setDisplayNameRequestSchema = z.object({
  machineId: z.string().min(1),
  path: z.string().min(1),
  displayName: z.string().trim().max(100).nullable(),
});

export type SetDisplayNameRequest = z.infer<typeof setDisplayNameRequestSchema>;
