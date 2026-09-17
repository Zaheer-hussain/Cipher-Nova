import mongoose from "mongoose";

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDatabase(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI.");
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    }).catch((error: unknown) => {
      connectionPromise = null;
      throw error;
    });
  }

  return connectionPromise;
}

export function getDatabaseStatus(): "connected" | "connecting" | "disconnected" {
  if (mongoose.connection.readyState === 1) return "connected";
  if (mongoose.connection.readyState === 2) return "connecting";
  return "disconnected";
}
