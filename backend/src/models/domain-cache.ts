import mongoose, { Schema } from "mongoose";

const domainCacheSchema = new Schema(
  {
    domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
    whoisData: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now, required: true },
  },
  { collection: "domainCache", versionKey: false },
);

domainCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export const DomainCacheModel =
  (mongoose.models.MailShieldDomainCache as mongoose.Model<unknown>) ??
  mongoose.model("MailShieldDomainCache", domainCacheSchema);
