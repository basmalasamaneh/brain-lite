import type { User as DbUser } from "@workspace/db";

export function publicUser(row: DbUser) {
  const parts = row.name.trim().split(/\s+/);
  return {
    id: row.id, email: row.email, name: row.name,
    firstName: parts[0], lastName: parts.slice(1).join(" "),
    language: row.language as "en" | "ar",
    theme: row.theme as "system" | "light" | "dark",
    onboardingCompleted: row.onboardingCompleted,
  };
}