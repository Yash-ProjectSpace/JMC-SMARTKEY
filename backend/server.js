require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { assignDutiesForPeriod } = require('./assignmentService'); 

const prisma = new PrismaClient();
const app = express();

const cron = require('node-cron');
const { getTargetWorkingDateBefore, getNextTwoWeeksWorkingDays, getHolidays } = require('./dateUtils');

// Middleware
app.use(cors()); 
// 🟢 画像データを受け取れるように容量制限を 50MB に引き上げる
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// ==========================================
// 👤 ユーザー名簿（個人URLと権限の管理）
// ==========================================
const USER_DIRECTORY = {
  // 👑 管理者 (ADMIN)
  "ヤシュワン": { url: process.env.WEBHOOK_YASWANTH, role: "ADMIN" },
  "内木 敦": { url: process.env.WEBHOOK_UCHIKI_SAN, role: "ADMIN" },
  "藤原 志帆": { url: process.env.WEBHOOK_FUJIWARA_SAN, role: "ADMIN" },
  "廣瀬 昌美": { url: process.env.WEBHOOK_HIROSE_SAN, role: "ADMIN" },

  // 👤 一般ユーザー (USER)
  //"Om": { url: process.env.WEBHOOK_OM, role: "USER" },
};

// ==========================================
// 🔔 HELPER: Google Chat Webhook Function
// ==========================================
async function sendWebhook(url, messageText) {
  if (!url) return;
  try {
    // 🟢 追加: メッセージの最後にアプリのURLを自動で追加する
    const appUrl = process.env.APP_URL;
    const finalMessage = appUrl 
      ? `${messageText}\n\n🔗 アプリを開く: ${appUrl}` 
      : messageText;

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text: finalMessage }),
    });
  } catch (error) {
    console.error("❌ 通知の送信に失敗しました:", error);
  }
}

async function notifyUser(userName, messageText) {
  const user = USER_DIRECTORY[userName];
  if (user && user.url) {
    await sendWebhook(user.url, messageText);
    console.log(`✅ ${userName} 個人のチャットに通知を送信しました。`);
  }
}

async function notifyAllUsers(messageText) {
  let count = 0;
  for (const userName in USER_DIRECTORY) {
    const user = USER_DIRECTORY[userName];
    if (user.url) {
      await sendWebhook(user.url, messageText);
      count++;
    }
  }
  console.log(`✅ 全員（${count}名）の個人チャットに一斉通知を送信しました。`);
}

async function notifyAdmins(messageText) {
  let count = 0;
  for (const userName in USER_DIRECTORY) {
    const user = USER_DIRECTORY[userName];
    if (user.role === "ADMIN" && user.url) {
      await sendWebhook(user.url, messageText);
      count++;
    }
  }
  console.log(`✅ 管理者（${count}名）の個人チャットに警告を送信しました。`);
}

// ==========================================
// 🧠 CORE LOGIC: The Duty Score & Fairness Engine
// ==========================================
async function findBestCandidate(targetDateStr, blacklistedUserIds = []) {
  // 1. Get eligible users (exclude admins and the blacklist for this specific date)
  const eligibleUsers = await prisma.user.findMany({
    where: {
      NOT: [
        //{ name: '内木 敦' },
        //{ name: '藤原 志帆' },
        { id: { in: blacklistedUserIds } }
      ]
    }
  });

  if (eligibleUsers.length === 0) return null; // Edge case: Everyone rejected

  // 2. Calculate Duty Score (Accepted/Pending/Completed duties)
  const allActiveDuties = await prisma.duty.findMany({
    where: { status: { not: 'REJECTED' } },
    orderBy: { date: 'asc' }
  });

    const userScores = eligibleUsers.map(user => {
    const duties = allActiveDuties.filter(d => d.userId === user.id);
    
    // 🟢 FIX 2: Only count ACCEPTED duties for the fairness score
    const acceptedCount = duties.filter(d => d.status === 'ACCEPTED').length;

    return {
      user,
      score: acceptedCount, // The updated metric for fairness
      dutyDates: duties.map(d => d.date) // Keep all duties here so the consecutive-day block still works!
    };
  });
  // Sort by lowest score first
  userScores.sort((a, b) => a.score - b.score);

  // 3. Build a sequential timeline to check for consecutive days easily
  const uniqueDates = [...new Set(allActiveDuties.map(d => d.date))];
  if (!uniqueDates.includes(targetDateStr)) {
     uniqueDates.push(targetDateStr);
     uniqueDates.sort();
  }
  const targetDateIndex = uniqueDates.indexOf(targetDateStr);

  let bestCandidate = null;

  // 4. Find the person with the lowest score who doesn't violate the consecutive rule
  for (const { user, dutyDates } of userScores) {
    const candidateDateIndexes = dutyDates.map(date => uniqueDates.indexOf(date));
    
    // Check if they are working the day immediately before (-1) or after (+1)
    const hasConsecutive = candidateDateIndexes.includes(targetDateIndex - 1) || 
                           candidateDateIndexes.includes(targetDateIndex + 1);

    if (!hasConsecutive) {
      bestCandidate = user; 
      break; 
    }
  }

  // 5. Fallback: If ALL candidates would trigger consecutive days, just pick the lowest score
  if (!bestCandidate) {
    bestCandidate = userScores[0].user;
  }

  return bestCandidate;
}

// ==========================================
// 🚀 ROUTES
// ==========================================

// 1. Get the Schedule (Raw Data)
app.get('/api/schedule', async (req, res) => {
  try {
    const duties = await prisma.duty.findMany({
      include: {
        user: true,
        keyLog: true,
      },
      orderBy: { id: 'asc' } 
    });

    const formattedSchedule = duties.map(duty => ({
      id: duty.id,
      date: duty.date,
      assignee: duty.user.name,
      status: duty.status,
      borrowedAt: duty.keyLog?.borrowedAt || null,
      returnedAt: duty.keyLog?.returnedAt || null,
    }));

    res.json(formattedSchedule);
  } catch (error) {
    console.error("Error fetching schedule:", error);
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

// 2. Update a Duty Status & Smart Reassign / Undo
app.patch('/api/schedule/:id', async (req, res) => {
  const { id } = req.params;
  const { status, manualAssignee } = req.body; // 🟢 FIX: extract manualAssignee 

  console.log(`\n[API] 📝 PATCH /api/schedule/${id} - Request: ${status || manualAssignee}`);
  try {
    const existingDuty = await prisma.duty.findUnique({ where: { id: parseInt(id) } });
    if (!existingDuty) return res.status(404).json({ error: "Duty not found" });
    // ==========================================
    // 🛠️ MANUAL OVERRIDE: Admin explicitly changes the assignee
    // ==========================================
    if (manualAssignee) {
      console.log(`[ADMIN OVERRIDE] 🛠️ Reassigning duty ${id} to ${manualAssignee}`);
      
      const targetUser = await prisma.user.findFirst({ where: { name: manualAssignee } });
      if (!targetUser) return res.status(404).json({ error: "User not found" });

      const updatedDuty = await prisma.duty.update({
        where: { id: parseInt(id) },
        data: {
          userId: targetUser.id,
          status: 'PENDING' // 🟢 Reset to pending so the new person has to accept
        },
        include: { user: true }
      });

      await notifyUser(targetUser.name, `🛠️ *管理者による指定*\n管理者があなたを ${updatedDuty.date} の鍵開け当番に指定しました。システムから承諾をお願いします。`);
      
      return res.json(updatedDuty);
    }
    const previousStatus = existingDuty.status;

    const updatedDuty = await prisma.duty.update({
      where: { id: parseInt(id) },
      data: { status: status },
      include: { user: true }
    });

    console.log(`[SUCCESS] ✅ ID:${id} (${updatedDuty.date}) updated to ${status}.`);
// 🟢 Extract baseDate once at the top so any logic block can use it
    const baseDate = updatedDuty.date.split(' ')[0];
// ==========================================
    // 🔙 UNDO LOGIC: Changed mind from Reject -> Accept
    // ==========================================
    if (status === 'ACCEPTED') {
      if (previousStatus === 'REJECTED') {

        // 🛑 0. 【新規追加】すでに代わりの人が承諾(ACCEPTED)していないかチェック（防衛ライン）
        const alreadyAcceptedBySomeoneElse = await prisma.duty.findFirst({
          where: {
            date: { startsWith: baseDate },
            status: 'ACCEPTED',
            id: { not: parseInt(id) } // 自分以外のデータ
          }
        });

        if (alreadyAcceptedBySomeoneElse) {
          console.log(`[BLOCK] 🚫 ${updatedDuty.user.name} tried to undo, but replacement already accepted.`);
          // 代わりの人がすでに承諾済みなら、403エラーを返してデータベースの変更をブロックする
          return res.status(403).json({ error: "すでに代わりの担当者がこの日程を承諾したため、取り消すことはできません。" });
        }

        // --- (ここからは既存のコードと同じです) ---
        console.log(`[UNDO] 🔙 Clearing auto-generated replacement for ${updatedDuty.date}`);

        // 🟢 1. レコードを消す前に、代わりの担当者（User B）を見つける
        const replacementDuty = await prisma.duty.findFirst({
          where: {
            date: { startsWith: baseDate },
            id: { not: parseInt(id) } 
          },
          include: { user: true }
        });

        // 🟢 2. 代わりの担当者がいたら「キャンセルされました」と個人チャットへ通知
        if (replacementDuty) {
          await notifyUser(
            replacementDuty.user.name, 
            `🔄 *担当取消のお知らせ*\n${updatedDuty.user.name}さんが「不可」を取り消して当番を承諾したため、あなたの ${updatedDuty.date} の鍵開け当番はキャンセルされました。`
          );
        }

        // 🟢 3. 代わりの人の当番データをデータベースから削除
        await prisma.duty.deleteMany({
          where: {
            date: { startsWith: baseDate },
            id: { not: parseInt(id) } 
          }
        });
        
        // 🟢 4. 管理者へ報告（すべて完了したことを伝える）
        //await notifyAdmins(`🔙 *取消通知*\n*${updatedDuty.user.name}* さんが ${updatedDuty.date} の「不可」を取り消し、鍵当番を再承諾しました。代替の担当者は自動でキャンセルされました。`);
      
      } else if (previousStatus !== 'ACCEPTED') {
        // 通常の承諾の場合（管理者のみに通知）
        console.log(`[ACTION] ${updatedDuty.user.name} accepted ${updatedDuty.date}. (No admin ping needed)`);
      }
    }
    // ==========================================
    // 🛑 SKIP LOGIC: Admin marked day as Not Needed
    // ==========================================
    else if (status === 'NOT_NEEDED') {
      console.log(`[SKIP] 🛑 Day marked as NOT_NEEDED for ${updatedDuty.date}`);
      
      // Clean up any replacement rows just in case this was clicked AFTER someone rejected
      await prisma.duty.deleteMany({
        where: {
          date: { startsWith: baseDate },
          id: { not: parseInt(id) }
        }
      });

      // Send a notification to the chat
      // 🟢 全員通知を廃止し、担当者本人のみに指定のメッセージを送信
      await notifyUser(updatedDuty.user.name, `🛑${updatedDuty.date}は祝日または休業のため、鍵開け当番は不要です。`);
      
      return res.json(updatedDuty);
    }
    // ==========================================
    // 🔄 UNDO CANCELLATION: Admin changes NOT_NEEDED -> PENDING
    // ==========================================
    else if (status === 'PENDING' && previousStatus === 'NOT_NEEDED') {
      console.log(`[RESTORE] 🔄 Admin restored duty for ${updatedDuty.date}. (No admin ping needed)`);
      
      // 🟢 担当者本人（1名）にのみ復活の通知を送る
      await notifyUser(
        updatedDuty.user.name,
        `🔄 *当番復活のお知らせ*\n管理者の操作により、キャンセルされていた ${updatedDuty.date} の鍵開け当番が「未回答」の状態に戻りました。お手数ですが、再度「承諾」または「不可」の回答をお願いいたします。`
      );
      
      return res.json(updatedDuty);
    }
// ==========================================
    // 🧠 REASSIGNMENT LOGIC (Score System)
    // ==========================================
    else if (status === 'REJECTED' && previousStatus !== 'REJECTED') {
      console.log(`[SMART-REASSIGN] 🧠 Starting reassignment logic...`);
      const targetDateStr = updatedDuty.date;

      // 🛑【新規追加】前日13時を過ぎていないかチェックする防衛ライン
      const baseDateStr = targetDateStr.split(' ')[0]; // 例: "2024-05-20"
      const deadline = new Date(`${baseDateStr}T13:00:00+09:00`); // 当番日の13時（日本時間）に設定
      deadline.setDate(deadline.getDate() - 1); // 1日引いて「前日の13時」にする

      const now = new Date(); // 現在のサーバー時刻
      
      if (now > deadline) {
        console.log(`[BLOCK] 🚫 ${updatedDuty.user.name} tried to reject, but it is past the 13:00 deadline.`);
        
        // 【超重要】すでに 'REJECTED' に更新されてしまったDBを元の状態に戻す（Revert）
        await prisma.duty.update({
          where: { id: parseInt(id) },
          data: { status: previousStatus }
        });

        // 403エラーを返して処理を終了する
        return res.status(403).json({ error: "前日の13時を過ぎているため、「不可」を選択することはできません。管理者に直接ご連絡ください。" });
      }
      // 🛑 追加ここまで

      // Find ALL previous rejections for this exact date to build the Blacklist
      const rejectedDuties = await prisma.duty.findMany({
        where: { date: targetDateStr, status: 'REJECTED' },
        select: { userId: true }
      });
      
      const blacklistedUserIds = rejectedDuties.map(duty => duty.userId);
      if (!blacklistedUserIds.includes(updatedDuty.userId)) {
        blacklistedUserIds.push(updatedDuty.userId);
      }

      // Use the Duty Score Engine to find the best replacement
      const bestCandidate = await findBestCandidate(targetDateStr, blacklistedUserIds);

      if (!bestCandidate) {
        console.log(`[SMART-REASSIGN] 🚨 No candidates left! Everyone rejected.`);
       await notifyAdmins(`🚨${duty.date}の鍵開け当番に割り当てられている ${duty.user.name} さんから返答がありません。 `);
        
        // 🟢 FIX: Added return here to match your other blocks safely
        return res.json(updatedDuty); 
      }

      const newDuty = await prisma.duty.create({
        data: {
          date: targetDateStr,
          status: 'PENDING',
          userId: bestCandidate.id
        }
      });
      
      console.log(`[SMART-REASSIGN] 🎉 Assigned to: ${bestCandidate.name}`);

      // 🟢 1. 管理者へ「誰が不可で、誰に再割り当てされたか」を詳しく通知
      //await notifyAdmins(`❌ *不可および自動再割当*\n${targetDateStr} の担当だった *${updatedDuty.user.name}* さんが不可としたため、新しい担当者として *${bestCandidate.name}* さんを自動割り当てしました。`);

      // 🟢 2. 新しい担当者本人へ通知
      await notifyUser(bestCandidate.name, `${updatedDuty.user.name}さんが不可のため、代わりに${newDuty.date}の鍵開けとなりました。`);
    }

    res.json(updatedDuty);
  } catch (error) {
    console.error(`[ERROR] ❌ Patch failed:`, error);
    res.status(500).json({ error: "Failed to update status and reassign" });
  }
});

// 3. Get User Stats
app.get('/api/stats', async (req, res) => {
  try {
    const users = await prisma.user.findMany({ include: { duties: true } });
    const stats = users.map(user => {
      const familyName = user.name.split(' ')[0] || user.name; 
      return {
        name: familyName,
        fullName: user.name, // 🟢 ADD THIS LINE: Pass the exact database name for the dropdown
        accepted: user.duties.filter(d => d.status === 'ACCEPTED').length,
        rejected: user.duties.filter(d => d.status === 'REJECTED').length,
      };
    });
    res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// 🚨 TEST ROUTE: Easy Database Reset
app.get('/api/schedule/reset', async (req, res) => {
  try {
    const deleted = await prisma.duty.deleteMany({});
    res.send(`<h1 style="color:red; text-align:center;">✨ Reset Complete. Deleted ${deleted.count} duties.</h1>`);
  } catch (error) {
    res.status(500).send("Reset failed.");
  }
});

// ==========================================
// 📅 5. AUTO-GENERATE 2 WEEKS (CALENDAR LOCKED)
// ==========================================
app.post('/api/schedule/generate', async (req, res) => {
  try {
    console.log("🚀 Generating schedule until the end of next week (Calendar Math)...");

    const publicHolidays = await getHolidays(); 

    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

// 🟢 SMART CALENDAR MATH: Find exactly the correct Friday
    let targetEndDate = new Date();
    const currentDayOfWeek = targetEndDate.getDay();
    
    let offsetToThisFriday = 0;
    if (currentDayOfWeek === 1) offsetToThisFriday = 4; // Mon -> This Fri
    if (currentDayOfWeek === 2) offsetToThisFriday = 3; // Tue -> This Fri
    if (currentDayOfWeek === 3) offsetToThisFriday = 2; // Wed -> This Fri
    if (currentDayOfWeek === 4) offsetToThisFriday = 1; // Thu -> This Fri
    if (currentDayOfWeek === 5) offsetToThisFriday = 0; // Fri -> This Fri
    if (currentDayOfWeek === 6) offsetToThisFriday = 6; // Sat -> Next Fri
    if (currentDayOfWeek === 0) offsetToThisFriday = 5; // Sun -> Next Fri

    // ✨ THE MAGIC RULE:
    // If clicked Mon-Thu: Stop at NEXT week's Friday (+7 days)
    // If clicked Fri-Sun: Stop at WEEK AFTER NEXT's Friday (+14 days)
    const extraDays = (currentDayOfWeek === 5 || currentDayOfWeek === 6 || currentDayOfWeek === 0) ? 14 : 7;
    
    targetEndDate.setDate(targetEndDate.getDate() + offsetToThisFriday + extraDays);
    targetEndDate.setHours(23, 59, 59, 999);

let generatedCount = 0;
    let startDate = null; // 🟢 Track the first generated date
    let endDate = null;   // 🟢 Track the last generated date
    const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];

    // 🟢 FIX: Loop by DATE limits instead of counting 10 days!
    while (currentDate <= targetEndDate) {
      const yyyy = currentDate.getFullYear();
      const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
      const dd = String(currentDate.getDate()).padStart(2, '0');
      const checkDateStr = `${yyyy}-${mm}-${dd}`;
      
      const dayOfWeek = currentDate.getDay();
      const isPublicHoliday = publicHolidays[checkDateStr] !== undefined;

      // Only process if NOT Weekend AND NOT Holiday
      if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isPublicHoliday) {
        
        // Skip if this exact date ALREADY exists in the database
        const existingDuty = await prisma.duty.findFirst({
          where: { date: { startsWith: checkDateStr } }
        });

        if (!existingDuty) {
          const formattedDate = `${checkDateStr} (${daysOfWeek[dayOfWeek]})`;
          const bestCandidate = await findBestCandidate(formattedDate, []);
          
          if (bestCandidate) {
            await prisma.duty.create({
              data: {
                date: formattedDate,
                status: 'PENDING',
                userId: bestCandidate.id
              }
            });
            generatedCount++;

            // 🟢 Capture the start and end dates
            if (!startDate) startDate = checkDateStr; 
            endDate = checkDateStr;
          }
        }
      }
      // Move forward exactly 1 calendar day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (generatedCount > 0) {
      // 🟢 Format the date range message
      const dateRangeText = (startDate === endDate) ? startDate : `${startDate} 〜 ${endDate}`;
      
      await notifyAllUsers(`🗓️ *スケジュール作成完了*\n【 ${dateRangeText} 】の期間に、祝日を除外して新しい鍵当番が追加されました。各自ダッシュボードから確認をお願いします。`);
    }

    // 🟢 Send the range back to the frontend alert
    res.status(201).json({ 
      message: "Generated successfully!", 
      count: generatedCount,
      range: startDate && endDate ? `${startDate} 〜 ${endDate}` : ""
    });
  } catch (error) {
    console.error("Error generating schedule:", error);
    res.status(500).json({ error: "Failed to generate schedule" });
  }
});

// ==========================================
// 🔒 6. AUTHENTICATION ROUTE (CRASH-PROOF VERSION)
// ==========================================
app.post('/api/login', async (req, res) => {
  const incomingEmail = req.body.email ? req.body.email.trim().toLowerCase() : '';
  
  console.log(`\n[LOGIN API] 🔑 ログイン試行: '${incomingEmail}'`);

  try {
    const allUsers = await prisma.user.findMany();
    
    const user = allUsers.find(u => {
      const dbEmail = u.email ? u.email.trim().toLowerCase() : '';
      return dbEmail === incomingEmail;
    });

    if (!user) {
      console.log(`[LOGIN API] 🔴 失敗: データベースに '${incomingEmail}' は存在しません。`);
      return res.status(403).json({ error: "Access Denied. You are not authorized." });
    }

    console.log(`[LOGIN API] 🟢 成功: ${user.name} (${user.role}) としてログインします。`);
    
    res.json({ 
      message: "Login successful", 
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      } 
    });
  } catch (error) {
    console.error("\n[LOGIN API] ❌ サーバーエラー詳細:", error);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ① FRIDAY 8:30 AM: Generate AND Send 2-week schedule to ALL users
cron.schedule('30 8 * * 5', async () => {
  console.log('⏰ Running Friday 8:30 AM Cron: Weekly Schedule Generation & Announcement');

  try {
    const publicHolidays = await getHolidays(); 
    
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    // 🟢 CALENDAR MATH: Find exactly the Friday of the "week after next"
    let targetEndDate = new Date();
    const currentDayOfWeek = targetEndDate.getDay();
    
    let daysUntilFriday = 5 - currentDayOfWeek;
    if (currentDayOfWeek === 6) daysUntilFriday = 6;
    if (currentDayOfWeek === 0) daysUntilFriday = 5;

    targetEndDate.setDate(targetEndDate.getDate() + daysUntilFriday + 14);
    targetEndDate.setHours(23, 59, 59, 999);

    const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
    let generatedCount = 0;

    // 🟢 FIX: Loop by DATE limits
    while (currentDate <= targetEndDate) {
      const yyyy = currentDate.getFullYear();
      const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
      const dd = String(currentDate.getDate()).padStart(2, '0');
      const checkDateStr = `${yyyy}-${mm}-${dd}`;
      
      const dayOfWeek = currentDate.getDay();
      const isPublicHoliday = publicHolidays[checkDateStr] !== undefined;

      if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isPublicHoliday) {
        const formattedDate = `${checkDateStr} (${daysOfWeek[dayOfWeek]})`;
        
        // Prevent duplicates
        const existing = await prisma.duty.findFirst({ where: { date: { startsWith: checkDateStr } } });
        
        if (!existing) {
          const bestCandidate = await findBestCandidate(formattedDate, []);
          if (bestCandidate) {
            await prisma.duty.create({
              data: { date: formattedDate, status: 'PENDING', userId: bestCandidate.id }
            });
            generatedCount++;
          }
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`✅ Schedule successfully generated in the database. (${generatedCount} days added)`);

    if (generatedCount > 0) {
      const msg = "来週および再来週の鍵開けスケジュールをお知らせします。割り当てられた日程をご確認のうえ、「承諾」または「不可」を選択してください。";
      await notifyAllUsers(msg);
      console.log('✅ Notification sent to all users.');
    }

  } catch (error) {
    console.error('❌ Error in Friday cron:', error);
  }
}, {
  scheduled: true,
  timezone: "Asia/Tokyo" 
});

// ==========================================
// 👤 PROFILE UPDATE ROUTE (UUID対応版)
// ==========================================
app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, avatar } = req.body;

  try {
    const updatedUser = await prisma.user.update({
      where: { id: id }, // 🟢 FIX: parseInt(id) ではなく id にする！
      data: {
        name: name,
        avatar: avatar
      }
    });

    res.json({
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        avatar: updatedUser.avatar
      }
    });
  } catch (error) {
    console.error("Failed to update profile:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ==========================================
// ⏰ AUTOMATED CRON JOBS (Daily Reminders & Alerts)
// ==========================================

// ② DAILY 10:00 AM: Individual Reminders (3 working days & 1 working day before)
cron.schedule('0 10 * * *', async () => {
  console.log('⏰ Running Daily 10:00 AM Cron: Individual Reminders');
  try {
    const todayStr = new Date().toLocaleDateString('en-CA'); 
    
    const upcomingDuties = await prisma.duty.findMany({
      where: { date: { gt: todayStr }, status: { not: 'REJECTED' } },
      include: { user: true }
    });

    for (const duty of upcomingDuties) {
      // SMART LOGIC: Accounts for weekends and holidays
      const reminder3DaysBefore = await getTargetWorkingDateBefore(duty.date, 3);
      const reminder1DayBefore = await getTargetWorkingDateBefore(duty.date, 1);

      // 🛑 1-Day Reminder Message (Different message based on status!)
      if (todayStr === reminder1DayBefore) {
        if (duty.status === 'ACCEPTED') {
          // 🟢 Normal reminder for people who already accepted
          await notifyUser(
            duty.user.name, 
            `⏰ *【リマインダー】明日の鍵開け当番*\n次の営業日（${duty.date}）はあなたの鍵開け当番です！朝のご対応よろしくお願いいたします。`
          );
          console.log(`[REMINDER] Sent 1-day NORMAL reminder to ${duty.user.name}`);
        } 
        else if (duty.status === 'PENDING') {
          // 🔴 SUPER Urgent reminder for people who still haven't responded
          await notifyUser(
            duty.user.name, 
            `🚨 *【超至急・未回答】明日の鍵開け当番*\n明日の営業日（${duty.date}）はあなたの鍵開け当番ですが、まだ回答がありません！至急ダッシュボードから「承諾」または「不可」を選択してください。`
          );
          console.log(`[REMINDER] Sent 1-day URGENT action request to ${duty.user.name}`);
        }
      }

      // 🛑 3-Day Reminder Message (Different message based on status!)
      if (todayStr === reminder3DaysBefore) {
        if (duty.status === 'ACCEPTED') {
          // 🟢 Normal reminder for people who already accepted
          await notifyUser(
            duty.user.name, 
            `🗓️ *【事前確認】*\n3営業日後の ${duty.date} はあなたの鍵開け当番です。ご準備のほどよろしくお願いいたします。`
          );
          console.log(`[REMINDER] Sent 3-day NORMAL reminder to ${duty.user.name}`);
        } 
        else if (duty.status === 'PENDING') {
          // 🔴 Urgent reminder for people who haven't responded
          await notifyUser(
            duty.user.name, 
            `🚨 *【至急・要回答】*\n3営業日後の ${duty.date} はあなたの鍵開け当番として予定されていますが、まだ回答がありません。「承諾」または「不可」の返信を至急行ってください。`
          );
          console.log(`[REMINDER] Sent 3-day URGENT action request to ${duty.user.name}`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error in Daily 10AM cron:', error);
  }
}, {
  scheduled: true,
  timezone: "Asia/Tokyo" 
});

// ④ DAILY 1:00 PM: Admin Warning for No Response
cron.schedule('0 13 * * *', async () => {
  console.log('⏰ Running Daily 1:00 PM Cron: Admin No-Response Alert');
  try {
    const todayStr = new Date().toLocaleDateString('en-CA'); 
    
    // Find only PENDING duties
    const pendingDuties = await prisma.duty.findMany({
      where: { date: { gt: todayStr }, status: 'PENDING' },
      include: { user: true }
    });

    for (const duty of pendingDuties) {
      const reminder1DayBefore = await getTargetWorkingDateBefore(duty.date, 1);
      
      // If today is exactly 1 working day before the duty, and it is STILL pending at 1:00 PM
      if (todayStr === reminder1DayBefore) {
        await notifyAdmins(`🚨 *警告*：${duty.date}の鍵開け担当者 *${duty.user.name}* さんからまだ返信（承諾/不可）がありません！至急確認してください。`);
      }
    }
  } catch (error) {
    console.error('❌ Error in Daily 1PM cron:', error);
  }
}, {
  scheduled: true,
  timezone: "Asia/Tokyo" 
});

// ==========================================
// 🚀 START THE SERVER
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend Server running on http://localhost:${PORT}`);
});