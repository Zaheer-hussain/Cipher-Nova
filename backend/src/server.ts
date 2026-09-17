import "./env.js";
import app from "./app.js";
import { connectDatabase } from "./db.js";

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`MailShield backend listening on port ${port}`);
  connectDatabase().catch((error: unknown) => {
    console.error("MongoDB is unavailable; database-backed routes will retry on request.", error);
  });
});
