import mongoose, { InferSchemaType, Schema } from "mongoose";

const domainCacheSchema = new Schema(
  {
    domain: { type: String, required: true, trim: true, lowercase: true },
    whoisData: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now, required: true },
  },
  {
    collection: "domainCache",
    versionKey: false,
  },
);

domainCacheSchema.index({ domain: 1 }, { unique: true });
domainCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export type DomainCacheDocument = InferSchemaType<typeof domainCacheSchema>;

export const DomainCacheModel =
  (mongoose.models.DomainCache as mongoose.Model<DomainCacheDocument>) ??
  mongoose.model<DomainCacheDocument>("DomainCache", domainCacheSchema);
