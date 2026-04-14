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
// 🟢 完璧な Squashロジック (土日を完全に排除する最強フィルター付き)
  const processScheduleData = (rawData) => {
    if (!Array.isArray(rawData)) return [];
    
    const groupedObj = {};
    rawData.forEach(duty => {
      const baseDate = duty.date.split(' ')[0]; 

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
    return squashedSchedule;
  };
  useEffect(() => {
    const fetchData = async () => {
      try {
        const scheduleRes = await fetch('http://localhost:5000/api/schedule');
        const scheduleData = await scheduleRes.json();
        // 🟢 Squashロジックを適用してセット
        setSchedule(processScheduleData(scheduleData));

        const statsRes = await fetch('http://localhost:5000/api/stats');
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
      const res = await fetch('http://localhost:5000/api/schedule/generate', {
        method: 'POST'
      });

      if (res.ok) {
        // Re-fetch all data
        const scheduleRes = await fetch('http://localhost:5000/api/schedule');
        const scheduleData = await scheduleRes.json();
        setSchedule(processScheduleData(scheduleData)); // 🟢 ここもSquash適用

        const statsRes = await fetch('http://localhost:5000/api/stats');
        const statsData = await statsRes.json();
        setUserStats(Array.isArray(statsData) ? statsData : []);

        alert("次の2週間分（10営業日）のスケジュールを自動生成しました！");
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
      await fetch(`http://localhost:5000/api/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      // 🟢 代理操作後、データベースの最新状態（UndoやReassignの結果）を取得してSquash
      const scheduleRes = await fetch('http://localhost:5000/api/schedule');
      const scheduleData = await scheduleRes.json();
      setSchedule(processScheduleData(scheduleData));

      const statsRes = await fetch('http://localhost:5000/api/stats');
      const statsData = await statsRes.json();
      setUserStats(Array.isArray(statsData) ? statsData : []);
    } catch (error) {
      console.error("Failed to update database:", error);
    }
  };

  const filteredSchedule = schedule.filter(row => {
    const assigneeName = row.assignee || '';
    const matchesSearch = assigneeName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || row.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const renderStatusBadge = (status) => {
    if (status === 'ACCEPTED') return <span className="inline-flex items-center space-x-1 px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full text-xs font-bold"><CheckCircle2 size={14} /> <span>承諾 (Accepted)</span></span>;
    if (status === 'REJECTED') return <span className="inline-flex items-center space-x-1 px-3 py-1 bg-red-50 text-red-600 border border-red-200 rounded-full text-xs font-bold"><XCircle size={14} /> <span>不可 (Rejected)</span></span>;
    // 🟢 ADD THIS LINE:
    if (status === 'NOT_NEEDED') return <span className="inline-flex items-center space-x-1 px-3 py-1 bg-slate-100 text-slate-400 border border-slate-200 rounded-full text-xs font-bold"><CheckCircle2 size={14} /> <span>不要 (Skipped)</span></span>;
    return <span className="inline-flex items-center space-x-1 px-3 py-1 bg-slate-100 text-slate-500 border border-slate-200 rounded-full text-xs font-bold"><Clock size={14} /> <span>回答待ち (Pending)</span></span>;
    
  };

  // 🟢 行の背景色ロジックを追加
  const getRowStyle = (status) => {
    if (status === 'ACCEPTED') return 'bg-green-50/50 hover:bg-green-100/50';
    if (status === 'REJECTED') return 'bg-red-50/50 hover:bg-red-100/50';
    // 🟢 ADD THIS LINE:
    if (status === 'NOT_NEEDED') return 'bg-slate-50 opacity-60 hover:bg-slate-100/60';
    return 'hover:bg-slate-50'; 
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] py-6 px-4 lg:px-8 space-y-8 font-sans">
      {/* SECTION 1: Scalable Horizontal User Stats */}
      <section>
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">全メンバーの実績確認 (Member Stats)</h3>
        <div className="flex space-x-4 overflow-x-auto pb-4 custom-scrollbar snap-x">
          {userStats.length > 0 ? (
            userStats.map((stat, i) => (
              <div key={i} className="min-w-[160px] bg-white border border-slate-200 rounded-xl p-4 shadow-sm snap-start shrink-0 hover:border-[#B01A24] transition-colors">
                <p className="text-sm font-semibold text-slate-600 mb-2">{stat.name}</p>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-2xl font-bold text-[#B01A24]">{stat.accepted}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">Accepted</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-500">{stat.rejected}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">Rejected</p>
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
              代理操作パネル (Admin Proxy)
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
                placeholder="Search employee..." 
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
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead className="bg-white border-b border-slate-100 text-slate-500 text-xs uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-6 py-4">日付 (Date)</th>
                <th className="px-6 py-4">担当者 (Assignee)</th>
                <th className="px-6 py-4">状況 (Status)</th>
                <th className="px-6 py-4 text-right">代理操作 (Action)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <AnimatePresence>
                {filteredSchedule.length > 0 ? (
                  filteredSchedule.map((row) => (
                    <motion.tr 
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      key={row.id} 
                      className={`transition-colors ${getRowStyle(row.status)}`} // 🟢 行の背景色を適用
                    >
                      <td className="px-6 py-4 font-medium text-slate-700">{row.date}</td>
                      
                      {/* 🟢 履歴（取り消し線）を表示する担当者カラム */}
                      <td className="px-6 py-4 text-slate-900 font-bold">
                        <div className="flex items-center flex-wrap gap-2">
                          {row.history && row.history.map((oldName, index) => (
                            <span key={index} className="line-through text-red-400/80 font-medium text-xs flex items-center">
                              {oldName}
                              <span className="text-slate-300 ml-2 no-underline">→</span>
                            </span>
                          ))}
                          <span>{row.assignee}</span>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4">{renderStatusBadge(row.status)}</td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button 
                          onClick={() => handleProxyAction(row.id, 'ACCEPTED')} 
                          disabled={row.status === 'ACCEPTED'} 
                          className="px-4 py-1.5 rounded-lg text-sm font-bold border border-slate-200 hover:border-[#B01A24] text-slate-700 hover:bg-[#B01A24] hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-700 disabled:hover:border-slate-200 cursor-pointer disabled:cursor-not-allowed">承諾</button>
                        <button 
                          onClick={() => handleProxyAction(row.id, 'REJECTED')} 
                          disabled={row.status === 'REJECTED'} 
                          className="px-4 py-1.5 rounded-lg text-sm font-bold border border-red-200 text-red-500 hover:bg-red-500 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-red-500 cursor-pointer disabled:cursor-not-allowed">不可</button>
                          {/* 🟢 Add the NOT_NEEDED button to your action buttons */}
                        {/* 🟢 FIX: Changed handleStatusChange to handleProxyAction, and duty.id to row.id */}
                        <button
                          onClick={() => handleProxyAction(row.id, 'NOT_NEEDED')}
                          disabled={row.status === 'NOT_NEEDED'}
                          className="px-4 py-1.5 rounded-lg text-sm font-bold border border-slate-200 text-slate-500 hover:bg-slate-500 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500 cursor-pointer disabled:cursor-not-allowed"
                          > 不要 </button>
                      </td>
                    </motion.tr>
                  ))
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