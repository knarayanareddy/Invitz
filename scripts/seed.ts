import "dotenv/config";
import { pool } from "../src/db";
import { seedDatabase } from "../src/lib/bootstrap";

async function main() {
  const withDemo = process.argv.includes("--demo") || process.env.INVITZ_DEMO_SEED === "true";
  await seedDatabase({ includeDemo: withDemo });
  console.log(`Seed complete (demo=${withDemo}).`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
