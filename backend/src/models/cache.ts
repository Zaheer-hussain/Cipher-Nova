import mongoose, { Schema } from "mongoose";

const cacheSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    data: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now, required: true },
  },
  { collection: "ipReputationCache", versionKey: false },
);

cacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export const IpReputationCacheModel =
  (mongoose.models.MailShieldIpReputationCache as mongoose.Model<unknown>) ??
  mongoose.model("MailShieldIpReputationCache", cacheSchema);
