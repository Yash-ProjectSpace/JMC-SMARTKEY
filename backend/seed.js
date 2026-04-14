const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Clearing old fake data...');
  // Delete all key logs and duties first (due to foreign key constraints), then users
  await prisma.keyLog.deleteMany({});
  await prisma.duty.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('🌱 Seeding real employee data...');

  // Note: I matched the exact emails from your image. 
  const employees = [
    { name: '廣瀬 昌美', email: 'm-hirose@jmc-ltd.co.jp', role: 'ADMIN' },
    { name: '山下 由菜', email: 'y-yamashita@jmc-ltd.co.jp', role: 'USER' },
    { name: '竹崎 奈保', email: 'n-takezaki@jmc-ltd.co.jp', role: 'ADMIN' },
    { name: '榛葉 絵美', email: 'e-shimba@jmc-ltd.co.jp', role: 'USER' },
    { name: '松岡 麻衣', email: 'mai-matsuoka@jmc-ltd.co.jp', role: 'ADMIN' },
    { name: '金尾 琴乃', email: 'k-kanao@jmc-ltd.co.jp', role: 'USER' },
    { name: '北川 真也', email: 's-kitagawa@jmc-ltd.co.jp', role: 'USER' },
    // The two branch admins (We will exclude them from the algorithm next)
    { name: '内木 敦', email: 's-fujiwara@jmc-ltd.co.jp', role: 'ADMIN' },
    { name: '藤原 志帆', email: 'a-uchiki@jmc-ltd.co.jp', role: 'ADMIN' },
    { name: 'ヤシュワン', email: 'y-paidi@jmc-ltd.co.jp', role: 'ADMIN' },
  ];

  for (const employee of employees) {
    await prisma.user.create({
      data: {
        name: employee.name,
        email: employee.email,
        role: employee.role,
      },
    });
  }

  console.log('✅ データベースの更新が完了しました！');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });