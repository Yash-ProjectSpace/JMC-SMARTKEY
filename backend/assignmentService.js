const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. 祝日リスト（ご提供いただいたデータを使用）
const HOLIDAY_LIST = {
    "2026-04-29": "昭和の日",
    "2026-05-03": "憲法記念日",
    "2026-05-04": "みどりの日",
    "2026-05-05": "こどもの日",
    "2026-05-06": "憲法記念日 振替休日",
    "2026-07-20": "海の日",
    "2026-08-11": "山の日",
    "2026-09-21": "敬老の日",
    "2026-09-22": "国民の休日",
    "2026-09-23": "秋分の日",
    "2026-10-12": "スポーツの日",
    "2026-11-03": "文化の日",
    "2026-11-23": "勤労感謝の日",
    "2027-01-01": "元日",
    "2027-01-11": "成人の日",
    "2027-02-11": "建国記念の日",
    "2027-02-23": "天皇誕生日",
    "2027-03-21": "春分の日",
    "2027-03-22": "春分の日 振替休日",
    "2027-04-29": "昭和の日",
    "2027-05-03": "憲法記念日",
    "2027-05-04": "みどりの日",
    "2027-05-05": "こどもの日",
    "2027-07-19": "海の日",
    "2027-08-11": "山の日",
    "2027-09-20": "敬老の日",
    "2027-09-23": "秋分の日",
    "2027-10-11": "スポーツの日",
    "2027-11-03": "文化の日",
    "2027-11-23": "勤労感謝の日"
};

// 2. 指定された期間内の稼働日（土日祝を除外）を取得
function getWorkingDaysInRange(startDate, endDate) {
  let workingDays = [];
  let currentDate = new Date(startDate);
  const end = new Date(endDate);

  while (currentDate <= end) {
    // タイムゾーンを日本時間に固定して文字列化 (YYYY-MM-DD)
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, '0');
    const d = String(currentDate.getDate()).padStart(2, '0');
    const dateString = `${y}-${m}-${d}`;
    
    const dayOfWeek = currentDate.getDay(); // 0: 日, 6: 土

    // 土日 (0 or 6) および 祝日リストに含まれる日を除外
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = HOLIDAY_LIST[dateString] !== undefined;

    if (!isWeekend && !isHoliday) {
      workingDays.push(dateString);
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  return workingDays;
}

// 3. コアアルゴリズム：公平な当番割り当て
async function assignDutiesForPeriod(startDate, endDate) {
  const workingDays = getWorkingDaysInRange(startDate, endDate);
  
  const users = await prisma.user.findMany({
    where: {
      email: {
        notIn: [
          's-fujiwara@jmc-ltd.co.jp', // 内木 敦
          'a-uchiki@jmc-ltd.co.jp'    // 藤原 志帆
        ]
      }
    },
    include: { duties: true }
  });

  if (users.length === 0) throw new Error("対象となるユーザーが見つかりません。");

  // 各ユーザーのスコア（公平性）を計算
  let userPool = users.map(user => {
    const completedCount = user.duties.filter(d => d.status === 'ACCEPTED').length;
    const declinedCount = user.duties.filter(d => d.status === 'REJECTED').length;
    // スコアが低いほど優先的に割り当て
    const assignmentScore = (completedCount * 10) - (declinedCount * 5);
    return { ...user, assignmentScore };
  });

  const newAssignments = [];
  let lastAssignedUserId = null;

  for (const date of workingDays) {
    // スコア順にソート
    userPool.sort((a, b) => a.assignmentScore - b.assignmentScore);

    // 2日連続の割り当てを防止
    let selectedUserIndex = 0;
    for (let i = 0; i < userPool.length; i++) {
      if (userPool[i].id !== lastAssignedUserId) {
        selectedUserIndex = i;
        break; 
      }
    }

    const selectedUser = userPool[selectedUserIndex];

    // データベースに登録
    await prisma.duty.create({
      data: {
        date: date,
        userId: selectedUser.id,
        status: 'PENDING'
      }
    });

    newAssignments.push({ date, user: selectedUser.name });
    
    // スコアを更新して次回以降の優先度を下げる
    userPool[selectedUserIndex].assignmentScore += 10; 
    lastAssignedUserId = selectedUser.id; 
  }

  console.log("✅ スケジュール作成完了:", newAssignments);
  return newAssignments;
}

module.exports = { assignDutiesForPeriod };