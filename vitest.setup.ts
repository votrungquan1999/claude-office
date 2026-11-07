import { existsSync } from "node:fs";

// A shell's connection settings must never reach a test: only useTestMongo may point it at a database.
delete process.env.MONGODB_URI;

// Use the installed mongod instead of downloading one; CI has no such path and falls back to the download.
const HOMEBREW_MONGOD = "/opt/homebrew/bin/mongod";
if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync(HOMEBREW_MONGOD)) {
  process.env.MONGOMS_SYSTEM_BINARY = HOMEBREW_MONGOD;
}
