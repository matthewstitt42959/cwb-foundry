import { PrismaClient } from "@prisma/client";

// Next.js hot-reloads modules in dev, which would otherwise create a fresh
// PrismaClient (and a fresh connection pool) on every edit. Reuse one instance.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
