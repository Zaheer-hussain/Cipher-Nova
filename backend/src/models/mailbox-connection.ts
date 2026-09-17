import mongoose, { Schema } from "mongoose";

const mailboxConnectionSchema = new Schema(
  {
    orgId: { type: String, required: true },
    userId: { type: String, required: true },
    provider: { type: String, enum: ["gmail", "outlook"], required: true },
    providerAccountId: { type: String, required: true },
    accountEmail: { type: String, required: true, lowercase: true, trim: true },
    encryptedTokens: { type: Schema.Types.Mixed, required: true, select: false },
    subscriptionId: { type: String, default: null },
    subscriptionResource: { type: String, default: null },
    subscriptionClientState: { type: String, default: null, select: false },
    subscriptionExpiresAt: { type: Date, default: null },
    lastWebhookHistoryId: { type: String, default: null },
    watchExpiry: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    status: { type: String, enum: ["active", "expired", "revoked", "error"], required: true },
  },
  { collection: "mailboxConnections", timestamps: true },
);

mailboxConnectionSchema.index({ userId: 1 });
mailboxConnectionSchema.index({ orgId: 1, provider: 1 });
mailboxConnectionSchema.index({ orgId: 1, provider: 1, providerAccountId: 1 }, { unique: true });
mailboxConnectionSchema.index({ provider: 1, subscriptionId: 1 }, { sparse: true });

export const MailboxConnectionModel =
  (mongoose.models.MailShieldMailboxConnection as mongoose.Model<unknown>) ??
  mongoose.model("MailShieldMailboxConnection", mailboxConnectionSchema);
