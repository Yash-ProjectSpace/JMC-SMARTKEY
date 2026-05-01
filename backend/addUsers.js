const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Checking and adding 5 new viewers...");

  const newUsers = [
    { name: "政岡 由衣", email: "y-masaoka@jmc-ltd.co.jp", role: "VIEWER" },
    { name: "野瀬 悦子", email: "e-nose@jmc-ltd.co.jp", role: "VIEWER" },
    { name: "篠岡 沙季", email: "s-shinooka@jmc-ltd.co.jp", role: "VIEWER" },
    { name: "山下 由菜", email: "y-yamashita@jmc-ltd.co.jp", role: "VIEWER" },
    { name: "宮本 梨瑛", email: "r-miyamoto@jmc-ltd.co.jp", role: "VIEWER" }
  ];

  for (const user of newUsers) {
    // Check if the user already exists so the script doesn't crash if run twice
    const existingUser = await prisma.user.findFirst({ where: { email: user.email } });
    
    if (!existingUser) {
      await prisma.user.create({ data: user });
      console.log(`✅ Added: ${user.name}`);
    } else {
      console.log(`⏭️ Skipped: ${user.name} already exists.`);
    }
  }

  console.log("🎉 Finished updating users!");
}

main().catch(console.error).finally(() => prisma.$disconnect());