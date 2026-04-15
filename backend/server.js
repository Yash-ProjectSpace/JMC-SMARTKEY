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
  "Sharath": { url: process.env.WEBHOOK_SHARATH, role: "ADMIN" },
  "内木 敦": { url: process.env.WEBHOOK_UCHIKI_SAN, role: "ADMIN" },
  "藤原 志帆": { url: process.env.WEBHOOK_FUJIWARA_SAN, role: "ADMIN" },

  // 👤 一般ユーザー (USER)
  "Om": { url: process.env.WEBHOOK_OM, role: "USER" },
  "HRIDAY": { url: process.env.WEBHOOK_HRIDAY, role: "USER" },
  "test1": { url: process.env.WEBHOOK_TEST1, role: "USER" },
  "test2": { url: process.env.WEBHOOK_TEST2, role: "USER" }
};

// ==========================================
// 🔔 HELPER: Google Chat Webhook Function
// ==========================================
async function sendWebhook(url, messageText) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text: messageText }),
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
        { name: '内木 敦' },
        { name: '藤原 志帆' },
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
    return {
      user,
      score: duties.length, // The core metric for fairness
      dutyDates: duties.map(d => d.date)
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
        console.log(`[UNDO] 🔙 Clearing auto-generated replacement for ${updatedDuty.date}`);

        // 🟢 FIX: Added the 'startsWith: baseDate' fix here to prevent ghost records!
        await prisma.duty.deleteMany({
          where: {
            date: { startsWith: baseDate },
            id: { not: parseInt(id) } 
          }
        });
        
        await notifyAllUsers(`🔙 *取消通知*\n*${updatedDuty.user.name}* さんが ${updatedDuty.date} の「不可」を取り消し、鍵当番を承諾しました！`);
      } else if (previousStatus !== 'ACCEPTED') {
        await notifyAllUsers(`✅ *承諾通知*\n*${updatedDuty.user.name}* さんが ${updatedDuty.date} の鍵当番を承諾しました！`);
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
    // 🧠 REASSIGNMENT LOGIC (Score System)
    // ==========================================
    else if (status === 'REJECTED' && previousStatus !== 'REJECTED') {
      console.log(`[SMART-REASSIGN] 🧠 Starting reassignment logic...`);
      const targetDateStr = updatedDuty.date;

      await notifyAdmins(`❌ *Rejection Notice*\n*${updatedDuty.user.name}* has declined the key duty for ${targetDateStr}. Searching for a new assignee...`);

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
       await notifyAdmins(`🚨 *警告：候補者なし*\n${targetDateStr} の当番を *${updatedDuty.user.name}* さんが不可としましたが、他に代われる人がいません！手動で調整してください。`);
        
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
      await notifyAdmins(`❌ *不可および自動再割当*\n${targetDateStr} の担当だった *${updatedDuty.user.name}* さんが不可としたため、新しい担当者として *${bestCandidate.name}* さんを自動割り当てしました。`);

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
// 📅 5. AUTO-GENERATE 2 WEEKS (MANUAL BUTTON)
// ==========================================
app.post('/api/schedule/generate', async (req, res) => {
  try {
    console.log("🚀 Generating 2 weeks of schedule...");

    // 1. Fetch holidays (using the correct name from your dateUtils)
    const publicHolidays = await getHolidays(); 
    
    const lastDuty = await prisma.duty.findFirst({ orderBy: { date: 'desc' } });

    let startDate = new Date();
    if (lastDuty && lastDuty.date) {
       const dateStr = lastDuty.date.split(' ')[0];
       startDate = new Date(dateStr);
       startDate.setDate(startDate.getDate() + 1); 
    } else {
       const dayOfWeek = startDate.getDay();
       if (dayOfWeek === 6) startDate.setDate(startDate.getDate() + 2); 
       else if (dayOfWeek === 0) startDate.setDate(startDate.getDate() + 1); 
    }

    let addedDays = 0;
    let currentDate = startDate;
    const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
    let generatedCount = 0;

    // 2. The Generation Loop
    while (addedDays < 10) {
      const yyyy = currentDate.getFullYear();
      const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
      const dd = String(currentDate.getDate()).padStart(2, '0');
      const checkDateStr = `${yyyy}-${mm}-${dd}`;
      
      const dayOfWeek = currentDate.getDay();
      
      // 🟢 Check if the date exists in the holiday API response
      const isPublicHoliday = publicHolidays[checkDateStr] !== undefined;

      // 🟢 Only assign if NOT Weekend AND NOT Holiday
      if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isPublicHoliday) {
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
        }
        addedDays++; 
      } else {
        console.log(`Skipping: ${checkDateStr} (${isPublicHoliday ? 'Holiday' : 'Weekend'})`);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    await notifyAllUsers(`📅 *スケジュール生成完了*\n祝日を除外して2週間分の鍵当番が生成されました。各自ダッシュボードから確認をお願いします。`);
    res.status(201).json({ message: "Generated successfully!", count: generatedCount });
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

// ==========================================
// ⏰ 7. CRON JOB: AUTOPILOT
// ==========================================
// Runs every Friday (5) at 08:00 AM. Assigns for the week *after* next.
cron.schedule('0 8 * * 5', async () => {
  console.log("⏰ [CRON] Starting Friday 8:00 AM Automated Assignment...");

  try {
    const today = new Date();
    
    // Jump to the Monday of the *week after next* (+10 days from Friday)
    let targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 10);

    const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
    let generatedCount = 0;

    // Generate Mon-Fri (5 days)
    for (let i = 0; i < 5; i++) {
      const yyyy = targetDate.getFullYear();
      const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
      const dd = String(targetDate.getDate()).padStart(2, '0');
      const formattedDate = `${yyyy}-${mm}-${dd} (${daysOfWeek[targetDate.getDay()]})`;

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
        console.log(`[CRON] 📅 Assigned ${formattedDate} to ${bestCandidate.name}`);
      }
      targetDate.setDate(targetDate.getDate() + 1);
    }

    if (generatedCount > 0) {
      await sendGoogleChatMessage(`⏰ *定期スケジュール生成*\n再来週の鍵当番スケジュールが自動生成されました！各自ダッシュボードから確認をお願いします。`);
    }

  } catch (error) {
    console.error("❌ [CRON] Failed during automated assignment:", error);
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
// ⏰ AUTOMATED CRON JOBS (Scheduling System)
// ==========================================

// ① FRIDAY 8:00 AM: Send 2-week schedule to ALL users
// ① FRIDAY 8:00 AM: Send 2-week schedule to ALL users

cron.schedule('1 8 * * 5', async () => {

  console.log('⏰ Running Friday 8:01 AM Cron: Weekly Schedule Announcement');

  try {

    const msg = "来週および再来週の鍵開けスケジュールをお知らせします。割り当てられた日程をご確認のうえ、「承諾」または「不可」を選択してください。";

    await notifyAllUsers(msg);

  } catch (error) {

    console.error('❌ Error in Friday cron:', error);

  }

});
// ② DAILY 8:00 AM: Individual Reminders (3 days before & 1 day before)
cron.schedule('0 8 * * *', async () => {
  console.log('⏰ Running Daily 8:00 AM Cron: Individual Reminders');
  try {
    // Note: We use today's date in YYYY-MM-DD format based on local server time
    const todayStr = new Date().toLocaleDateString('en-CA'); 
    
    // Find all future duties that haven't been rejected
    const upcomingDuties = await prisma.duty.findMany({
      where: { date: { gt: todayStr }, status: { not: 'REJECTED' } },
      include: { user: true }
    });

    for (const duty of upcomingDuties) {
      // Calculate exactly 3 working days before and 1 working day before
      const reminder3DaysBefore = await getTargetWorkingDateBefore(duty.date, 3);
      const reminder1DayBefore = await getTargetWorkingDateBefore(duty.date, 1);

      // 🟢 ここを差し替えました！3日前と前日で全く同じ処理（メッセージ）を実行します
      if (todayStr === reminder3DaysBefore || todayStr === reminder1DayBefore) {
        // 3営業日前、または1営業日前の両方で同じメッセージを送信
        await notifyUser(
          duty.user.name, 
          `${duty.date}が鍵開けの日です。\n承諾も不可も押していない場合は、「承諾」か「不可」を押してください。`
        );
      }
    }
  } catch (error) {
    console.error('❌ Error in Daily 8AM cron:', error);
  }
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
        // 🟢 先頭に 🚨 を追加
        await notifyAdmins(`🚨 ${duty.date}の鍵開け担当者${duty.user.name}さんから返信がありません。`);
      }
    }
  } catch (error) {
    console.error('❌ Error in Daily 1PM cron:', error);
  }
});

// ==========================================
// 🚀 START THE SERVER
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend Server running on http://localhost:${PORT}`);
});