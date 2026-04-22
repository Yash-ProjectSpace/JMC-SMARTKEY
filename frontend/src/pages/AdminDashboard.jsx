import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Clock, UserCog, Search, Filter, AlertCircle, CalendarPlus } from 'lucide-react';

export default function AdminDashboard() {
  const [schedule, setSchedule] = useState([]);
  const [userStats, setUserStats] = useState([]); 
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  
  const [isGenerating, setIsGenerating] = useState(false);

// 🟢 HELPER: 取得したデータを「1日1行」にまとめ、古い担当者を history に入れるロジック
  // 🟢 完璧な Squashロジック (土日を完全に排除する最強フィルター付き ＋ 過去の日付を非表示)
  const processScheduleData = (rawData) => {
    if (!Array.isArray(rawData)) return [];
    
    const groupedObj = {};
    // 🟢 追加1: 今日の日付を取得 (YYYY-MM-DD)
    const todayStr = new Date().toISOString().split('T')[0];

    rawData.forEach(duty => {
      const baseDate = duty.date.split(' ')[0]; 

      // 🟢 追加2: 今日の日付より前のデータ（過去の当番）は完全に無視する！
      if (baseDate < todayStr) return;

      // 1. Safely parse the date to avoid Javascript timezone bugs
      const [y, m, d] = baseDate.split('-');
      const dObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      const dayIndex = dObj.getDay();

      // 🚨 THE FILTER: If it is Sunday (0) or Saturday (6), COMPLETELY IGNORE IT!
      if (dayIndex === 0 || dayIndex === 6) return;

      if (!groupedObj[baseDate]) {
        groupedObj[baseDate] = { ...duty, history: [] };
        
        if (!duty.date.includes('(')) {
          const days = ['日', '月', '火', '水', '木', '金', '土'];
          groupedObj[baseDate].date = `${baseDate} (${days[dayIndex]})`;
        }
      } else {
        const previousAssignee = groupedObj[baseDate].assignee;
        const newAssignee = duty.assignee;

        if (previousAssignee && previousAssignee !== newAssignee) {
          groupedObj[baseDate].history.push(previousAssignee);
        }

        groupedObj[baseDate].id = duty.id;
        groupedObj[baseDate].assignee = newAssignee;
        groupedObj[baseDate].status = duty.status;
      }
    });
    
    const squashedSchedule = Object.values(groupedObj);
    squashedSchedule.sort((a, b) => new Date(a.date.split(' ')[0]) - new Date(b.date.split(' ')[0]));

    // 🟢 NEW: Calendar Math to perfectly detect a new week (even after holidays!)
    for (let i = 1; i < squashedSchedule.length; i++) {
      const prevDateStr = squashedSchedule[i - 1].date.split(' ')[0];
      const currDateStr = squashedSchedule[i].date.split(' ')[0];

      const [pY, pM, pD] = prevDateStr.split('-');
      const [cY, cM, cD] = currDateStr.split('-');
      
      const prevD = new Date(parseInt(pY), parseInt(pM) - 1, parseInt(pD));
      const currD = new Date(parseInt(cY), parseInt(cM) - 1, parseInt(cD));

      // Calculate exact days between rows
      const diffDays = (currD - prevD) / (1000 * 60 * 60 * 24);
      
      // If the gap is 7+ days, OR if the day of the week goes backwards (e.g. Friday to Thursday), it crossed a weekend!
      if (diffDays >= 7 || currD.getDay() <= prevD.getDay()) {
        squashedSchedule[i].isNewWeek = true;
      }
    }

    return squashedSchedule;
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const scheduleRes = await fetch('https://kiitoban.jmc-ltd.co.jp/api/schedule');
        const scheduleData = await scheduleRes.json();
        // 🟢 Squashロジックを適用してセット
        setSchedule(processScheduleData(scheduleData));

        const statsRes = await fetch('https://kiitoban.jmc-ltd.co.jp/api/stats');
        const statsData = await statsRes.json();
        setUserStats(Array.isArray(statsData) ? statsData : []);
      } catch (error) {
        console.error("Failed to fetch data from backend:", error);
      }
    };
    fetchData();
  }, []);

const handleGenerateSchedule = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('https://kiitoban.jmc-ltd.co.jp/api/schedule/generate', {
        method: 'POST'
      });

      if (res.ok) {
        // 🟢 1. GET THE REPLY FROM THE BACKEND FIRST!
        const generateData = await res.json();

        // Re-fetch all data to update the table
        const scheduleRes = await fetch('https://kiitoban.jmc-ltd.co.jp/api/schedule');
        const scheduleData = await scheduleRes.json();
        setSchedule(processScheduleData(scheduleData)); 

        const statsRes = await fetch('https://kiitoban.jmc-ltd.co.jp/api/stats');
        const statsData = await statsRes.json();
        setUserStats(Array.isArray(statsData) ? statsData : []);

        // 🟢 2. USE THE DYNAMIC DATA FOR THE ALERT
        if (generateData.count > 0) {
          alert(`【 ${generateData.range} 】のスケジュールを更新しました！`);
        } else {
          alert("追加が必要な新しい日程はありませんでした。"); // "No new days needed to be added"
        }
      } else {
        const errorData = await res.json();
        alert(`エラー: ${errorData.error}`);
      }
    } catch (error) {
      console.error("Failed to generate schedule:", error);
      alert("スケジュールの生成に失敗しました。");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleProxyAction = async (id, newStatus) => {
    // Optimistic Update (仮の更新)
    setSchedule(currentSchedule => 
      currentSchedule.map(row => row.id === id ? { ...row, status: newStatus } : row)
    );

    try {
      await fetch(`https://kiitoban.jmc-ltd.co.jp/api/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      // 🟢 代理操作後、データベースの最新状態（UndoやReassignの結果）を取得してSquash
      const scheduleRes = await fetch('https://kiitoban.jmc-ltd.co.jp/api/schedule');
      const scheduleData = await scheduleRes.json();
      setSchedule(processScheduleData(scheduleData));

      const statsRes = await fetch('https://kiitoban.jmc-ltd.co.jp/api/stats');
      const statsData = await statsRes.json();
      setUserStats(Array.isArray(statsData) ? statsData : []);
    } catch (error) {
      console.error("Failed to update database:", error);
    }
  };

  // 🟢 NEW CODE: Manual Assign function
  const handleManualAssign = async (id, newAssigneeFullName) => {
    // 1. Optimistic Update (仮の更新)
    setSchedule(currentSchedule => 
      currentSchedule.map(row => row.id === id ? { ...row, assignee: newAssigneeFullName, status: 'PENDING' } : row)
    );

    try {
      // 2. Send the new name to the backend
      await fetch(`https://kiitoban.jmc-ltd.co.jp/api/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualAssignee: newAssigneeFullName }),
      });

      // 3. Refresh data
      const scheduleRes = await fetch('https://kiitoban.jmc-ltd.co.jp/api/schedule');
      const scheduleData = await scheduleRes.json();
      setSchedule(processScheduleData(scheduleData));
    } catch (error) {
      console.error("Failed to reassign manually:", error);
    }
  };

  const filteredSchedule = schedule.filter(row => {
    const assigneeName = row.assignee || '';
    const matchesSearch = assigneeName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || row.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const renderStatusBadge = (status) => {
    // 🟢 CHANGED: w-[88px] (slimmer), py-1 (shorter), text-[11px] (smaller text), size={12} (smaller icons), and space-x-1 (tighter gap)
    if (status === 'ACCEPTED') return <span className="inline-flex items-center justify-center space-x-1 w-[88px] py-1 bg-green-50 text-green-700 border border-green-200 rounded-full text-[11px] font-bold shadow-sm"><CheckCircle2 size={12} /> <span>承諾</span></span>;
    if (status === 'REJECTED') return <span className="inline-flex items-center justify-center space-x-1 w-[88px] py-1 bg-red-50 text-red-600 border border-red-200 rounded-full text-[11px] font-bold shadow-sm"><XCircle size={12} /> <span>不可</span></span>;
    if (status === 'NOT_NEEDED') return <span className="inline-flex items-center justify-center space-x-1 w-[88px] py-1 bg-slate-100 text-slate-500 border border-slate-300 rounded-full text-[11px] font-bold shadow-sm"><CheckCircle2 size={12} /> <span>不要</span></span>;
    
    return <span className="inline-flex items-center justify-center space-x-1 w-[88px] py-1 bg-slate-100 text-slate-600 border border-slate-300 rounded-full text-[11px] font-bold shadow-sm"><Clock size={12} /> <span>回答待ち</span></span>;
  };
  const getRowStyle = (status) => {
    if (status === 'ACCEPTED') return 'bg-green-50/50 hover:bg-green-100/50';
    if (status === 'REJECTED') return 'bg-red-50/50 hover:bg-red-100/50';
    if (status === 'NOT_NEEDED') return 'bg-slate-50 opacity-60 hover:bg-slate-100/60';
    return 'hover:bg-slate-50'; 
  };
  // 🛑 FIX 1: 【ここに追加】前日13時を過ぎているか判定する関数
  const isPastDeadline = (dutyDateString) => {
    if (!dutyDateString) return false;
    const baseDateStr = dutyDateString.split(' ')[0]; 
    const deadline = new Date(`${baseDateStr}T13:00:00+09:00`); 
    deadline.setDate(deadline.getDate() - 1); 
    return new Date() > deadline; 
  };
  return (
    <div className="min-h-screen bg-[#FAF8F5] py-6 px-4 lg:px-8 space-y-8 font-sans">
      {/* SECTION 1: Scalable Horizontal User Stats */}
      <section>
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">全メンバーの実績確認</h3>
        <div className="flex space-x-4 overflow-x-auto pb-4 custom-scrollbar snap-x pt-2">
          {userStats.length > 0 ? (
            userStats.map((stat, i) => (
              /* 🟢 FIX: 元の2列デザインに戻し、ホバーでフワッと浮き上がるエフェクトを追加！ */
              <div key={i} className="min-w-[160px] bg-white border border-slate-200 rounded-xl p-4 shadow-sm snap-start shrink-0 hover:-translate-y-1.5 hover:shadow-md hover:border-[#B01A24] transition-all duration-300 cursor-default">
                <p className="text-sm font-semibold text-slate-600 mb-2">{stat.name}</p>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-2xl font-bold text-[#B01A24]">{stat.accepted}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">承認済み</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-500">{stat.rejected}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">不承認</p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">Loading stats...</p>
          )}
        </div>
      </section>
      {/* SECTION 2: Search, Filter & Table */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        
        <div className="p-4 border-b border-slate-200 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <UserCog className="text-[#B01A24]" />
              代理操作パネル 
            </h2>
            
            <button 
              onClick={handleGenerateSchedule}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-black text-white text-xs font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CalendarPlus size={14} />
              {isGenerating ? "生成中..." : "2週間分を自動生成"}
            </button>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                placeholder="社員検索..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#B01A24] w-full md:w-64 shadow-none"
              />
            </div>

            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#B01A24] appearance-none bg-white cursor-pointer shadow-none"
              >
                <option value="ALL">すべての状況</option>
                <option value="ACCEPTED">承諾</option>
                <option value="REJECTED">不可</option>
                <option value="NOT_NEEDED">不要</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead className="bg-white border-b border-slate-100 text-slate-500 text-xs uppercase tracking-wider font-semibold">
              <tr>
                {/* 🟢 Force single line, exact fit */}
                <th className="px-6 py-4 w-[1%] whitespace-nowrap">日付</th>
                
                {/* 🟢 FIX: Added 'text-center' to align perfectly with the dropdowns below */}
                <th className="px-6 py-4 text-center">担当者</th>
                
                {/* 🟢 Force single line, exact fit */}
                <th className="px-6 py-4 w-[1%] whitespace-nowrap">状況</th>
                <th className="px-6 py-4 w-[1%] whitespace-nowrap">代理操作</th>
              </tr>
            </thead>
            {/* 🟢 FIX 1: Removed "divide-y divide-slate-100" from here so it stops blocking our custom borders! */}
<tbody className="bg-white">
              <AnimatePresence>
                {filteredSchedule.length > 0 ? (
                  filteredSchedule.flatMap((row, index) => {
                    
                    const rowElements = [];

                    // 🌟 BETTER UI: Inject a beautiful, slim sub-header row for new weeks!
                    if (row.isNewWeek) {
                      rowElements.push(
                        <motion.tr
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          key={`divider-${row.id}`}
                          className="bg-slate-50"
                        >
                          <td colSpan="4" className="px-6 py-3 border-y border-slate-200">
    {/* 🟢 REMOVED: opacity-70. CHANGED: text-[11px] and text-slate-700 for better contrast */}
    <div className="flex items-center gap-3 w-full">
      <div className="h-px bg-slate-300 flex-grow"></div>
      <span className="text-[11px] font-bold text-slate-700 uppercase tracking-widest bg-slate-50 px-2">
        新しい週 
      </span>
      <div className="h-px bg-slate-300 flex-grow"></div>
    </div>
  </td>
                        </motion.tr>
                      );
                    }

                    // 🟢 The actual data row
                    rowElements.push(
                      <motion.tr 
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        key={row.id} 
                        className={`transition-colors border-t border-slate-100 ${getRowStyle(row.status)}`}
                      >
                        {/* 🟢 FIX 2: Date column is forced to a single line and fixed minimum width */}
                        <td className="px-6 py-4 font-medium text-slate-700 whitespace-nowrap w-[1%] text-left">
                          {row.date}
                        </td>
                        
                        {/* 🟢 FIX 3: Assignee column is horizontally centered and flexible (allows line wrap) */}
                        <td className="px-6 py-4 text-slate-900 font-bold">
                          {/* 🟢 justify-center centers the history arrows and dropdown group */}
                          <div className="flex items-center justify-center flex-wrap gap-2 text-center">
                            {row.history && row.history.map((oldName, i) => (
                              <span key={i} className="line-through text-red-400/80 font-medium text-xs flex items-center">
                                {oldName}
                                <span className="text-slate-300 ml-2 no-underline">→</span>
                              </span>
                            ))}
                            
                            {/* 🟢 THE DROPDOWN MENU (text is centered implicitly by the parent text-center) */}
                            <select 
                              value={row.assignee}
                              onChange={(e) => handleManualAssign(row.id, e.target.value)}
                              className="bg-white border border-slate-200 text-slate-800 text-sm rounded-lg focus:ring-[#B01A24] focus:border-[#B01A24] block w-[160px] p-1.5 cursor-pointer font-bold shadow-sm"
                            >
                              {userStats.map(stat => (
                                <option key={stat.fullName || stat.name} value={stat.fullName || stat.name}>
                                  {stat.fullName || stat.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        
                        {/* 🟢 FIX 2: Status column is forced to a single line and fixed minimum width */}
                        <td className="px-6 py-4 whitespace-nowrap w-[1%] text-left">
                          {renderStatusBadge(row.status)}
                        </td>
                        
                        {/* 🟢 FIX 2: Action column is forced to a single line and fixed minimum width */}
{/* 🟢 FIX 2: Action column is forced to a single line and fixed minimum width */}
<td className="px-6 py-4 whitespace-nowrap w-[1%] text-left">
  {/* Reduced container min-width slightly to match smaller buttons */}
  <div className="flex items-center justify-start gap-3 flex-nowrap min-w-[260px]">
    
    {/* BLACK BUTTON: REJECT */}
    <button 
      onClick={() => handleProxyAction(row.id, 'REJECTED')} 
      disabled={row.status === 'REJECTED' || isPastDeadline(row.date)} 
      className="flex items-center justify-center w-[80px] h-[32px] rounded-full font-bold text-[11px] tracking-wider bg-black text-white shadow-md shadow-black/20 hover:bg-gray-800 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 disabled:opacity-40 disabled:hover:bg-black disabled:-translate-y-0 disabled:shadow-sm disabled:cursor-not-allowed"
    >
      {row.status === 'REJECTED' ? '不可登録済' : isPastDeadline(row.date) ? '期限切れ' : '不可'}
    </button>
    
    {/* RED BUTTON: ACCEPT */}
    <button 
      onClick={() => handleProxyAction(row.id, 'ACCEPTED')} 
      disabled={row.status === 'ACCEPTED'} 
      className="flex items-center justify-center w-[80px] h-[32px] rounded-full font-bold text-[11px] tracking-wider bg-[#B01A24] text-white shadow-md shadow-[#B01A24]/20 hover:bg-red-800 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 disabled:opacity-40 disabled:hover:bg-[#B01A24] disabled:-translate-y-0 disabled:shadow-sm disabled:cursor-not-allowed"
    >
      {row.status === 'ACCEPTED' ? '承諾済み' : '承諾'}
    </button>
    
    {/* SLATE/BLUE BUTTON: NOT NEEDED */}
    {row.status === 'NOT_NEEDED' ? (
      <button
        onClick={() => handleProxyAction(row.id, 'PENDING')}
        className="flex items-center justify-center w-[80px] h-[32px] rounded-full font-bold text-[11px] tracking-wider bg-blue-600 text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 cursor-pointer"
      >
        元に戻す
      </button>
    ) : (
      <button
        onClick={() => handleProxyAction(row.id, 'NOT_NEEDED')}
        className="flex items-center justify-center w-[80px] h-[32px] rounded-full font-bold text-[11px] tracking-wider bg-[#64748B] text-white shadow-md shadow-slate-500/20 hover:bg-slate-600 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 cursor-pointer"
      >
        不要
      </button>
    )}
    
  </div>
</td>
                      </motion.tr>
                    );

                    return rowElements;
                  })
                ) : (
                  <tr>
                    <td colSpan="4" className="px-6 py-12 text-center text-slate-500">
                      <AlertCircle className="mx-auto mb-2 text-slate-300" size={32} />
                      <p>No records match your search or the database is empty.</p>
                    </td>
                  </tr>
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}