import mongoose, { Schema } from "mongoose";

const campaignSchema = new Schema(
  {
    orgId: { type: String, required: true, index: true },
    campaignKey: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    linkedDomains: { type: [String], default: [] },
    linkedIps: { type: [String], default: [] },
    scanIds: { type: [Schema.Types.ObjectId], default: [] },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    riskLevel: { type: String, required: true },
  },
  { collection: "campaigns" },
);

campaignSchema.index({ linkedDomains: 1 });
campaignSchema.index({ linkedIps: 1 });
campaignSchema.index({ orgId: 1, campaignKey: 1 }, { unique: true });

export const CampaignModel =
  (mongoose.models.MailShieldCampaign as mongoose.Model<unknown>) ??
  mongoose.model("MailShieldCampaign", campaignSchema);
