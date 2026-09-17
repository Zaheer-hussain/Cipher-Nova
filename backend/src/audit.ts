import { AuditLogModel } from "./models/audit-log.js";

export async function writeAuditLog(input: {
  actorId: string;
  action: string;
  targetId: string;
  targetType: string;
  ipAddress?: string | null;
}) {
  return AuditLogModel.create({
    ...input,
    ipAddress: input.ipAddress ?? null,
  });
}
