require('dotenv').config(); // 🟢 ADD THIS LINE TO THE VERY TOP!
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Clearing old fake data...');
  // Delete all key logs and duties first (due to foreign key constraints), then users
  await prisma.keyLog.deleteMany({});
  await prisma.duty.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('🌱 Seeding real employee data...');

  const employees = [
    // 👑 管理者 (当番なし - Admins with NO duty)
    { name: 'ヤシュワン', email: 'y-paidi@jmc-ltd.co.jp', role: 'ADMIN' },
    { name: '内木 敦', email: 'a-uchiki@jmc-ltd.co.jp', role: 'ADMIN' },    // Fixed email
    { name: '藤原 志帆', email: 's-fujiwara@jmc-ltd.co.jp', role: 'ADMIN' }, // Fixed email

    // 👑 管理者 (当番あり - Admins WITH duty)
    { name: '廣瀬 昌美', email: 'm-hirose@jmc-ltd.co.jp', role: 'ADMIN' },
    { name: '竹﨑 奈保', email: 'n-takezaki@jmc-ltd.co.jp', role: 'ADMIN' }, // Fixed Kanji: 﨑
    { name: '松岡 麻衣', email: 'mai-matsuoka@jmc-ltd.co.jp', role: 'ADMIN' }, // Check if this is mai- or m-

    // 👤 一般ユーザー (当番あり - Users WITH duty)
    { name: '山下 由菜', email: 'y-yamashita@jmc-ltd.co.jp', role: 'USER' },
    { name: '榛葉 絵美', email: 'e-shimba@jmc-ltd.co.jp', role: 'USER' },
    { name: '金尾 琴乃', email: 'k-kanao@jmc-ltd.co.jp', role: 'USER' },
    { name: '北川 真也', email: 's-kitagawa@jmc-ltd.co.jp', role: 'USER' },
    //{ name: '芝 優生', email: 'y-shiba@jmc-ltd.co.jp', role: 'USER' }      // Added Shiba-san
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