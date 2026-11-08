import { z } from "zod";

/** A start folder of one Mac as the office API sends it. */
export const folderDtoSchema = z.object({
  machineId: z.string(),
  path: z.string(),
  /** Whether the folder groups its sub-folders into one company. */
  companyMode: z.boolean(),
});

export type FolderDto = z.infer<typeof folderDtoSchema>;
