import mongoose, { Schema } from "mongoose";

const auditLogSchema = new Schema(
  {
    actorId: { type: String, required: true },
    action: { type: String, required: true },
    targetId: { type: String, required: true },
    targetType: { type: String, required: true },
    timestamp: { type: Date, default: Date.now, required: true },
    ipAddress: { type: String, default: null },
  },
  { collection: "auditLog", versionKey: false },
);

auditLogSchema.index({ targetId: 1, timestamp: -1 });
auditLogSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"], () => {
  throw new Error("Audit logs are append-only.");
});

export const AuditLogModel =
  (mongoose.models.MailShieldAuditLog as mongoose.Model<unknown>) ??
  mongoose.model("MailShieldAuditLog", auditLogSchema);
