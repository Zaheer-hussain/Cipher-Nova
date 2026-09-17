import mongoose, { InferSchemaType, Schema } from "mongoose";

const geolocationSchema = new Schema(
  {
    country: { type: String, default: null },
    region: { type: String, default: null },
    city: { type: String, default: null },
    isp: { type: String, default: null },
    isProxy: { type: Boolean, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
  },
  { _id: false },
);

const authResultsSchema = new Schema(
  {
    spf: { type: String, default: "none" },
    dkim: { type: String, default: "none" },
    dmarc: { type: String, default: "none" },
  },
  { _id: false },
);

const groqAnalysisSchema = new Schema(
  {
    urgencyScore: { type: Number, min: 0, max: 100, required: true },
    impersonationDetected: { type: Boolean, required: true },
    suspiciousRequests: { type: [String], default: [] },
    toneFlags: { type: [String], default: [] },
    category: {
      type: String,
      enum: ["phishing", "BEC", "spam", "legitimate"],
      required: true,
    },
    confidence: { type: Number, min: 0, max: 1, required: true },
  },
  { _id: false },
);

const geminiAnalysisSchema = new Schema(
  {
    triggered: { type: Boolean, required: true },
    reason: { type: String, required: true },
    finalCategory: {
      type: String,
      enum: ["phishing", "BEC", "spam", "legitimate"],
      required: true,
    },
    explanation: { type: String, required: true },
  },
  { _id: false },
);

const domainIntelligenceSchema = new Schema(
  {
    available: { type: Boolean, required: true },
    registrationDate: { type: String, default: null },
    ageDays: { type: Number, default: null },
    registrar: { type: String, default: null },
    source: { type: String, enum: ["rdap", "cache", "unavailable"], required: true },
  },
  { _id: false },
);

const scanSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    senderEmail: { type: String, required: true, trim: true, lowercase: true },
    senderDomain: { type: String, required: true, trim: true, lowercase: true },
    originIp: { type: String, default: null },
    geolocation: { type: geolocationSchema, required: true },
    authResults: { type: authResultsSchema, required: true },
    groqAnalysis: { type: groqAnalysisSchema, required: true },
    geminiAnalysis: { type: geminiAnalysisSchema, default: null },
    domainIntelligence: {
      type: domainIntelligenceSchema,
      required: true,
      default: () => ({
        available: false,
        registrationDate: null,
        ageDays: null,
        registrar: null,
        source: "unavailable",
      }),
    },
    trustScore: { type: Number, min: 0, max: 100, required: true },
    reasons: { type: [String], default: [] },
    riskLabel: {
      type: String,
      enum: ["Safe", "Suspicious", "Likely Phishing", "Confirmed Malicious"],
      required: true,
    },
  },
  {
    collection: "scans",
    timestamps: { createdAt: true, updatedAt: false },
  },
);

scanSchema.index({ userId: 1, createdAt: -1 });
scanSchema.index({ senderDomain: 1 });
scanSchema.index({ originIp: 1 });

export type ScanDocument = InferSchemaType<typeof scanSchema>;

export const ScanModel = (mongoose.models.Scan as mongoose.Model<ScanDocument>) ??
  mongoose.model<ScanDocument>("Scan", scanSchema);
