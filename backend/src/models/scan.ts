import mongoose, { Schema } from "mongoose";

const scanSchema = new Schema(
  {
    orgId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    source: { type: String, enum: ["manual", "auto"], required: true },
    rawEmailHash: { type: String, required: true },
    rawEmailEncrypted: { type: String, required: true, select: false },
    senderEmail: { type: String, required: true, lowercase: true, trim: true },
    senderDomain: { type: String, required: true, lowercase: true, trim: true },
    replyToDomain: { type: String, default: null },
    returnPathDomain: { type: String, default: null },
    relayChain: { type: [Schema.Types.Mixed], default: [] },
    originIp: { type: String, default: null },
    geolocation: { type: Schema.Types.Mixed, default: {} },
    authResults: { type: Schema.Types.Mixed, default: {} },
    domainIntel: { type: Schema.Types.Mixed, default: {} },
    groqAnalysis: { type: Schema.Types.Mixed, required: true },
    geminiAnalysis: { type: Schema.Types.Mixed, default: null },
    attribution: { type: Schema.Types.Mixed, default: {} },
    trustScore: { type: Number, min: 0, max: 100, required: true },
    riskLabel: { type: String, required: true },
    reasons: { type: [String], default: [] },
    alertSent: { type: Boolean, default: false },
  },
  { collection: "scans", timestamps: { createdAt: true, updatedAt: false } },
);

scanSchema.index({ orgId: 1, createdAt: -1 });
scanSchema.index({ senderDomain: 1 });
scanSchema.index({ originIp: 1 });
scanSchema.index({ "attribution.campaignId": 1 });
scanSchema.index({ senderEmail: "text", senderDomain: "text" });

export const ScanModel =
  (mongoose.models.MailShieldScan as mongoose.Model<unknown>) ??
  mongoose.model("MailShieldScan", scanSchema);
