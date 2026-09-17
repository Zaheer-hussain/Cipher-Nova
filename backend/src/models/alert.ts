import mongoose, { Schema } from "mongoose";

const alertSchema = new Schema(
  {
    orgId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    scanId: { type: Schema.Types.ObjectId, ref: "MailShieldScan", required: true },
    severity: { type: String, enum: ["medium", "high", "critical"], required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ["open", "acknowledged", "resolved"], default: "open", required: true },
    createdAt: { type: Date, default: Date.now, required: true },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { collection: "securityAlerts", versionKey: false },
);

alertSchema.index({ orgId: 1, status: 1, createdAt: -1 });
alertSchema.index({ userId: 1, status: 1, createdAt: -1 });
alertSchema.index({ scanId: 1 }, { unique: true });

export const AlertModel =
  (mongoose.models.MailShieldAlert as mongoose.Model<unknown>) ??
  mongoose.model("MailShieldAlert", alertSchema);
