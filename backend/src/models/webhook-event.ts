import mongoose, { Schema } from "mongoose";

const webhookEventSchema = new Schema(
  {
    provider: { type: String, enum: ["gmail", "outlook"], required: true },
    eventKey: { type: String, required: true, unique: true },
    resourceId: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["accepted", "processing", "processed", "failed"], required: true },
    receivedAt: { type: Date, default: Date.now, required: true },
    claimedAt: { type: Date, default: null },
    claimedBy: { type: String, default: null },
    processedAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
  },
  { collection: "mailboxWebhookEvents", versionKey: false },
);

webhookEventSchema.index({ provider: 1, receivedAt: -1 });
webhookEventSchema.index({ status: 1, receivedAt: 1 });

export const WebhookEventModel =
  (mongoose.models.MailShieldWebhookEvent as mongoose.Model<unknown>) ??
  mongoose.model("MailShieldWebhookEvent", webhookEventSchema);
