import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { KeyRound, CalendarDays, CheckCircle2, XCircle, Check, X, BarChart3, Users, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown } from 'lucide-react';

export default function UserDashboard({ currentUser }) {
  const [duties, setDuties] = useState([]);
  const [fullCompanySchedule, setFullCompanySchedule] = useState([]);
  const [stats, setStats] = useState({ accepted: 0, rejected: 0, pending: 0 });
  
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  const jpFont = { fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif' };

const fetchData = async () => {
    try {
      const res = await fetch('https://kiitoban.jmc-ltd.co.jp/api/schedule');
      const allData = await res.json();
      
      if (!Array.isArray(allData)) return;

      const todayStr = new Date().toISOString().split('T')[0];

      // 🟢 1. 【追加】誰かがすでに「承諾(ACCEPTED)」している日付のリストを作る
      const acceptedDatesByAnyone = new Set(
        allData
          .filter(item => item.status === 'ACCEPTED')
          .map(item => item.date.split(' ')[0])
      );

      // 🟢 自分の当番を抽出し、同じ日付の重複データがあれば優先度の高いものを1つだけ残す
      const myDutiesMap = new Map();
      
      allData.forEach(item => {
        const baseDate = item.date.split(' ')[0];
        
        if (item.assignee === currentUser?.name && baseDate >= todayStr) {
          
          // 🛑 2. 【追加】自分が「不可(REJECTED)」にしていて、かつ他の誰かがすでに「承諾」しているなら、このカードは非表示にする
          if (item.status === 'REJECTED' && acceptedDatesByAnyone.has(baseDate)) {
            return; // myDutiesMap に追加せずにスキップ（画面から消える）
          }

          if (!myDutiesMap.has(baseDate)) {
            myDutiesMap.set(baseDate, item);
          } else {
            const existing = myDutiesMap.get(baseDate);
            // ステータスの表示優先度（数字が大きいほど優先して表示する）
            const statusScore = { 'ACCEPTED': 4, 'PENDING': 3, 'NOT_NEEDED': 2, 'REJECTED': 1 };
            
            if (statusScore[item.status] > statusScore[existing.status]) {
              myDutiesMap.set(baseDate, item);
            } else if (statusScore[item.status] === statusScore[existing.status] && item.id > existing.id) {
              // 優先度が同じ場合は、新しく作られたデータ（IDが大きい方）を残す
              myDutiesMap.set(baseDate, item);
            }
          }
        }
      });

      const myDuties = Array.from(myDutiesMap.values());
      
      // 🟢 日付が近い順（昇順）に並び替える
      myDuties.sort((a, b) => new Date(a.date.split(' ')[0]) - new Date(b.date.split(' ')[0]));
      
      setDuties(myDuties);
      
      const accepted = myDuties.filter(d => d.status === 'ACCEPTED').length;
      const rejected = myDuties.filter(d => d.status === 'REJECTED').length;
      const pending = myDuties.filter(d => d.status === 'PENDING').length;
      setStats({ accepted, rejected, pending });

      const groupedObj = {};
      allData.forEach(duty => {
        const baseDate = duty.date.split(' ')[0]; 

        if (baseDate < todayStr) return;

        const [y, m, d] = baseDate.split('-');
        const dObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        const dayIndex = dObj.getDay();

        if (dayIndex === 0 || dayIndex === 6) return;

        if (!groupedObj[baseDate]) {
          groupedObj[baseDate] = { ...duty, history: [] };
          if (!duty.date.includes('(')) {
            const days = ['日', '月', '火', '水', '木', '金', '土'];
            groupedObj[baseDate].date = `${baseDate} (${days[dayIndex]})`;
          }
        } else {
          const previousAssignee = groupedObj[baseDate].assignee;
          if (previousAssignee && previousAssignee !== duty.assignee) {
            groupedObj[baseDate].history.push(previousAssignee);
          }
          groupedObj[baseDate].id = duty.id;
          // ※ここは全体のスケジュール用の処理なので、このままでOKです
          groupedObj[baseDate].assignee = duty.assignee;
          groupedObj[baseDate].status = duty.status;
        }
      });
      
      const squashedSchedule = Object.values(groupedObj);
      squashedSchedule.sort((a, b) => new Date(a.date.split(' ')[0]) - new Date(b.date.split(' ')[0]));
      
      setFullCompanySchedule(squashedSchedule);

    } catch (error) {
      console.error("Failed to fetch schedule:", error);
    }
  };
  useEffect(() => {
    fetchData();
  }, [currentUser?.name]);

  const handleMyResponse = async (id, newStatus) => {
    setDuties(prev => prev.map(d => d.id === id ? { ...d, status: newStatus } : d));
    setFullCompanySchedule(prev => prev.map(row => row.id === id ? { ...row, status: newStatus } : row));

    try {
      const response = await fetch(`https://kiitoban.jmc-ltd.co.jp/api/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      // 🛑 バックエンドからのブロック（13時以降の遅延クリック）を検知
      if (!response.ok) {
        if (response.status === 403) {
          // ご希望のメッセージをアラートで表示
          alert("⚠️ エラー\n既に前日の13時を過ぎているため「不可」を選択できません。スケジュールの変更については管理者にご連絡ください。");
          fetchData(); // 画面を元の正しい状態（REJECTEDになっていない状態）に戻す
          return;
        }
      }
      if (response.ok) {
        setTimeout(() => {
          fetchData();
        }, 150);
      }
    } catch (error) {
      console.error("Update failed:", error);
      fetchData();
    }
  };
  // 🛑 FIX 1: 【ここに追加】前日13時を過ぎているか判定する関数
  const isPastDeadline = (dutyDateString) => {
    if (!dutyDateString) return false;
    const baseDateStr = dutyDateString.split(' ')[0]; 
    const deadline = new Date(`${baseDateStr}T13:00:00+09:00`); 
    deadline.setDate(deadline.getDate() - 1); 
    return new Date() > deadline; 
  };

  const chartData = useMemo(() => [
    { name: '承諾済み', value: stats.accepted, fill: '#B01A24' }, 
    { name: '不可登録', value: stats.rejected, fill: '#18181B' }, 
    { name: '回答待ち', value: stats.pending, fill: '#64748B' },  
  ], [stats]);

  const scheduleRange = useMemo(() => {
    if (!fullCompanySchedule || fullCompanySchedule.length === 0) return "";
    const formatRangeDate = (dateStr) => {
      const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s(\(.+\))/);
      if (match) return `${parseInt(match[2])}/${parseInt(match[3])}${match[4]}`;
      return dateStr; 
    };
    return `${formatRangeDate(fullCompanySchedule[0].date)}〜${formatRangeDate(fullCompanySchedule[fullCompanySchedule.length - 1].date)}`;
  }, [fullCompanySchedule]);

  const renderCalendar = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

    for (let i = 0; i < 42; i++) {
      if (i < firstDayOfMonth || i >= firstDayOfMonth + daysInMonth) {
        days.push(<div key={`empty-${i}`} className="p-0"></div>);
      } else {
        const d = i - firstDayOfMonth + 1;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const myDutyForDay = duties.find(duty => duty.date.startsWith(dateStr));
        const isWeekend = new Date(year, month, d).getDay() === 0 || new Date(year, month, d).getDay() === 6;

        let bgColor = "transparent";
        let textColor = isWeekend ? "text-slate-300" : "text-slate-700";
        let badge = null;
        let isDateFaded = false;

        if (myDutyForDay) {
          if (myDutyForDay.status === 'ACCEPTED') {
            textColor = "text-[#B01A24] font-extrabold";
            isDateFaded = true;
            badge = <Check size={22} strokeWidth={4} className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-[#B01A24] z-10" />;
          } else if (myDutyForDay.status === 'REJECTED') {
            textColor = "text-black font-extrabold";
            isDateFaded = true;
            badge = <X size={20} strokeWidth={4} className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-black z-10" />;
          } else if (myDutyForDay.status === 'NOT_NEEDED') {
            // 🟢 Calendar representation for NOT_NEEDED
            textColor = "text-slate-400 font-extrabold";
            isDateFaded = true;
            badge = <svg viewBox="0 0 100 100" className="w-5 h-5 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-slate-300 z-10"><line x1="20" y1="80" x2="80" y2="20" stroke="currentColor" strokeWidth="12" strokeLinecap="round" /></svg>;
          } else {
            bgColor = "bg-[#B01A24] shadow-md shadow-red-900/20";
            textColor = "text-white font-extrabold";
          }
        }

        days.push(
          <div key={d} className="flex justify-center items-center py-0.5">
            <div className={`relative w-7 h-7 lg:w-8 lg:h-8 flex items-center justify-center rounded-full text-xs lg:text-sm transition-all ${bgColor} ${textColor}`}>
              <span className={`${isDateFaded ? "opacity-30" : ""} relative z-0 leading-none mt-[1px]`}>{d}</span>
              {badge}
            </div>
          </div>
        );
      }
    }

    return (
      <div className="bg-white p-4 lg:p-5 rounded-2xl shadow-sm border border-slate-200 h-full flex flex-col relative overflow-hidden hover:-translate-y-1 hover:shadow-md transition-all duration-300">
        
        {/* Header */}
        <div className="flex justify-center items-center mb-2 shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={() => setCalendarMonth(new Date(year, month - 1, 1))} className="p-1 hover:bg-slate-100 rounded-lg text-slate-500"><ChevronLeft size={18} /></button>
            <span className="text-sm lg:text-base font-bold text-slate-700 w-24 text-center">{year}年 {month + 1}月</span>
            <button onClick={() => setCalendarMonth(new Date(year, month + 1, 1))} className="p-1 hover:bg-slate-100 rounded-lg text-slate-500"><ChevronRight size={18} /></button>
          </div>
        </div>
        
        {/* Days of week */}
        <div className="grid grid-cols-7 gap-0 mb-1 shrink-0">
          {weekDays.map((wd, i) => (
             <div key={wd} className={`text-center text-[10px] lg:text-xs font-bold ${i === 0 || i === 6 ? 'text-slate-300' : 'text-slate-400'}`}>{wd}</div>
          ))}
        </div>
        
        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-y-1 lg:gap-y-1.5 flex-1 min-h-0 content-start">
          {days}
        </div>
        
        {/* Legend */}
        <div className="mt-auto shrink-0 flex items-center justify-center gap-4 lg:gap-6 text-[10px] lg:text-xs font-medium text-slate-500 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 leading-none">
            <div className="w-3 h-3 rounded-full bg-[#B01A24]"></div> 
            <span className="mt-[1px]">未回答</span>
          </div>
          <div className="flex items-center gap-1 leading-none">
            <Check size={14} strokeWidth={4} className="text-[#B01A24]" /> 
            <span className="mt-[1px]">承諾済み</span>
          </div>
          <div className="flex items-center gap-1 leading-none">
            <X size={14} strokeWidth={4} className="text-black" /> 
            <span className="mt-[1px]">不可</span>
          </div>
        </div>
        
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] py-6 px-4 lg:px-8 space-y-8 font-sans">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch lg:h-[380px]">
        
        {/* 1. 担当カレンダー */}
        <section className="flex flex-col h-full min-h-0">
          <div className="flex items-center justify-between mb-4 h-8 shrink-0">
            <h2 style={jpFont} className="text-sm font-extrabold text-[#B01A24] tracking-wider flex items-center gap-2">
              <CalendarDays size={16} /> 担当カレンダー
            </h2>
          </div>
          <div className="flex-grow min-h-0">
            {renderCalendar()}
          </div>
        </section>

{/* 2. あなたの担当予定 */}
        <section className="flex flex-col h-[380px] lg:h-full min-h-0">
          <div className="flex items-center justify-between mb-4 h-8 shrink-0">
            <h2 style={jpFont} className="text-sm font-extrabold text-[#B01A24] tracking-wider flex items-center gap-2">
              <KeyRound size={16} /> あなたの担当予定
            </h2>
          </div>

          <div className="relative flex-grow min-h-0">
            {duties.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center h-full flex flex-col items-center justify-center lg:absolute lg:inset-0 min-h-[200px] lg:min-h-0">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 className="text-slate-300" size={28} />
                </div>
                <h3 className="text-slate-500 font-bold mb-1 text-sm lg:text-base">担当予定はありません</h3>
                <p className="text-slate-400 text-xs lg:text-sm">割り当てをお待ちください。</p>
              </div>
            ) : (
              <>
                {/* 🟢 FIX 1: absolute inset-0 を使って親枠の中に完全に閉じ込める！ 3枚以上の時だけスクロールバーを出す */}
                <div className={`flex flex-col gap-3 lg:gap-4 absolute inset-0 ${duties.length > 2 ? 'overflow-y-auto custom-scrollbar pr-2 pb-10' : ''}`}>
                  {duties.map((duty) => (
                    /* 🟢 FIX 2: 条件分岐！ 2枚以下の時はエフェクトあり(hover:...)。3枚以上の時はエフェクトなし。 */
                    <div 
                      key={duty.id} 
                      className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-4 lg:p-5 flex flex-col justify-between relative overflow-hidden shrink-0 min-h-[155px] ${
                        duties.length <= 2 
                          ? 'hover:-translate-y-1 hover:shadow-md hover:border-red-200 transition-all duration-300 flex-1' 
                          : ''
                      }`}
                    >
                      
                      {/* 🔴 CLASSIC MARU (CIRCLE) */}
                      {duty.status === 'ACCEPTED' && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.08] z-0 text-[#B01A24]">
                          <svg viewBox="0 0 100 100" className="w-32 h-32 lg:w-40 lg:h-40">
                            <circle cx="50" cy="50" r="35" stroke="currentColor" strokeWidth="12" fill="none" />
                          </svg>
                        </div>
                      )}

                      {/* ⚫ CLASSIC BATSU (X) */}
                      {duty.status === 'REJECTED' && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.06] z-0 text-black">
                          <svg viewBox="0 0 100 100" className="w-32 h-32 lg:w-40 lg:h-40">
                            <path d="M25,25 L75,75 M75,25 L25,75" stroke="currentColor" strokeWidth="14" strokeLinecap="round" fill="none" />
                          </svg>
                        </div>
                      )}

                      {/* ⚪ SKIPPED (NOT NEEDED) */}
                      {duty.status === 'NOT_NEEDED' && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.10] z-0 text-slate-500">
                          <svg viewBox="0 0 100 100" className="w-32 h-32 lg:w-40 lg:h-40">
                            <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="8" fill="none" />
                            <line x1="20" y1="80" x2="80" y2="20" stroke="currentColor" strokeWidth="8" />
                          </svg>
                        </div>
                      )}

                      <div className="flex justify-between items-start relative z-10">
                        <div>
                          <p className="text-slate-400 text-[10px] lg:text-xs font-bold mb-0.5">当番スケジュール</p>
                          <h3 className="text-sm lg:text-base font-bold text-slate-800">本社 鍵開け当番</h3>
                        </div>
                        <CalendarDays className="text-slate-300" size={18} />
                      </div>
                      
                      <div className="text-center relative z-10 my-auto">
                        <p className={`font-bold tracking-tight text-[#B01A24] ${
                          duties.length === 1 ? 'text-4xl lg:text-5xl' : 'text-2xl lg:text-3xl'
                        }`}>
                          {duty.date}
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 lg:gap-3 relative z-10 mt-2">
                        <button 
                          onClick={() => handleMyResponse(duty.id, 'REJECTED')}
                          // 🛑 FIX 3: 【変更】isPastDeadline(duty.date) を追加
                          disabled={duty.status === 'REJECTED' || duty.status === 'NOT_NEEDED' || isPastDeadline(duty.date)}
                          className="py-1.5 lg:py-2 rounded-lg font-bold text-xs bg-black text-white hover:bg-gray-800 transition-all shadow-md shadow-black/20 disabled:opacity-40 disabled:hover:bg-black flex items-center justify-center gap-1.5"
                        >
                          <XCircle size={14} />
                          {/* 🛑 FIX 3: 【変更】13時を過ぎていたら「期限切れ」と表示させる */}
                          {duty.status === 'REJECTED' ? '不可登録済' : isPastDeadline(duty.date) ? '13時期限切れ' : '不可'}
                        </button>
                        <button
                          onClick={() => handleMyResponse(duty.id, 'ACCEPTED')}
                          disabled={duty.status === 'ACCEPTED' || duty.status === 'NOT_NEEDED'}
                          className="py-1.5 lg:py-2 rounded-lg font-bold text-xs bg-[#B01A24] text-white hover:bg-red-800 transition-all shadow-md shadow-red-900/20 disabled:opacity-40 disabled:hover:bg-[#B01A24] flex items-center justify-center gap-1.5"
                        >
                          <CheckCircle2 size={14} />
                          {duty.status === 'ACCEPTED' ? '承諾済み' : '承諾'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 🟢 NEW: Mobile Scroll Indicator (Only shows on phones, only if > 2 duties) */}
                {duties.length > 2 && (
                  <div className="absolute bottom-0 left-0 right-2 h-12 bg-gradient-to-t from-[#FAF8F5] via-[#FAF8F5]/80 to-transparent pointer-events-none z-20 flex items-end justify-center pb-1 lg:hidden">
                    <span className="text-[10px] font-bold text-slate-500 bg-white/90 px-3 py-1 rounded-full shadow-sm border border-slate-200 animate-bounce">
                      ↓ 下にスクロール
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* 3. あなたの実績 */}
        <section className="flex flex-col h-full min-h-0">
          <div className="mb-4 h-8 shrink-0">
            <h2 style={jpFont} className="text-sm font-extrabold text-[#B01A24] tracking-wider flex items-center gap-2">
              <BarChart3 size={16} /> あなたの実績
            </h2>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 lg:p-6 flex flex-col items-center justify-center flex-grow min-h-0 hover:-translate-y-1 hover:shadow-md transition-all duration-300">
            <div className="w-full h-full min-h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontWeight: 'bold' }}
                  />
                  <Legend verticalAlign="bottom" height={24} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </div>

      {/* 下部：全社スケジュールテーブル */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        <div className="p-5 lg:p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 style={jpFont} className="text-sm font-extrabold text-[#B01A24] flex items-center gap-2">
            <Users size={18} /> 
            全社当番スケジュール
          </h2>
          <span className="text-[10px] lg:text-xs font-bold text-[#B01A24] tracking-wider bg-white px-3 py-1 lg:px-4 lg:py-1.5 rounded-full border border-slate-200 shadow-sm">
            {scheduleRange}
          </span>
        </div>
        <div className="overflow-y-auto max-h-[350px] custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="bg-white sticky top-0 z-10 border-b border-slate-100 text-slate-400 text-[10px] lg:text-xs uppercase font-bold tracking-wider">
              <tr>
                <th className="px-4 lg:px-6 py-3 lg:py-4">日付</th>
                <th className="px-4 lg:px-6 py-3 lg:py-4">担当者</th>
                <th className="px-4 lg:px-6 py-3 lg:py-4 text-right">状況</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {fullCompanySchedule.length > 0 ? (
                fullCompanySchedule.map((row) => {
                  let rowBgClass = "hover:bg-slate-50 transition-colors";
                  if (row.assignee === currentUser?.name) {
                    if (row.status === 'ACCEPTED') {
                      rowBgClass = "bg-green-50/50 hover:bg-green-100/50 transition-colors"; 
                    } else if (row.status === 'REJECTED') {
                      rowBgClass = "bg-gray-100/30 hover:bg-gray-200/50 transition-colors"; 
                    } else if (row.status === 'NOT_NEEDED') {
                      // 🟢 Added background behavior for NOT_NEEDED rows
                      rowBgClass = "bg-slate-50 text-slate-400 opacity-70 transition-colors";
                    } else {
                      rowBgClass = "bg-slate-100 hover:bg-slate-200 transition-colors"; 
                    }
                  }

                  return (
                    <tr key={row.id} className={rowBgClass}>
                      <td className="px-4 lg:px-6 py-3 lg:py-4 text-xs lg:text-sm font-medium text-slate-600 whitespace-nowrap">{row.date}</td>
                      <td className="px-4 lg:px-6 py-3 lg:py-4 text-xs lg:text-sm font-bold text-slate-900 flex items-center flex-wrap gap-1.5 lg:gap-2">
                        {row.history && row.history.map((oldName, index) => (
                          <span key={index} className="line-through text-slate-400 font-medium text-[10px] lg:text-xs flex items-center">
                            {oldName}
                            <span className="text-slate-300 ml-1 lg:ml-2 no-underline">→</span>
                          </span>
                        ))}
                        <span className={row.assignee === currentUser?.name && row.status !== 'ACCEPTED' && row.status !== 'NOT_NEEDED' ? 'text-[#B01A24]' : 'text-slate-900'}>
                          {row.assignee} 
                        </span>
                      </td>
<td className="px-4 lg:px-6 py-3 lg:py-4 text-right whitespace-nowrap">
  {row.status === 'ACCEPTED' ? (
    <span className="inline-flex items-center justify-center w-[76px] py-0.5 bg-green-50 text-green-700 border border-green-200 rounded-full text-[10px] font-bold shadow-sm tracking-wider">
      承諾済み
    </span>
  ) : row.status === 'REJECTED' ? (
    <span className="inline-flex items-center justify-center w-[76px] py-0.5 bg-gray-900 text-white border border-black rounded-full text-[10px] font-bold shadow-sm line-through decoration-white/50 tracking-wider">
      不可
    </span>
  ) : row.status === 'NOT_NEEDED' ? (
    <span className="inline-flex items-center justify-center w-[76px] py-0.5 bg-slate-100 text-slate-500 border border-slate-300 rounded-full text-[10px] font-bold shadow-sm tracking-wider">
      不要
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-[76px] py-0.5 bg-slate-100 text-slate-600 border border-slate-300 rounded-full text-[10px] font-bold shadow-sm tracking-wider">
      未回答
    </span>
  )}
</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="3" className="px-6 py-8 text-center text-slate-400 text-sm">データがありません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}