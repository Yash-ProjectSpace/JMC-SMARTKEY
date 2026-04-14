import React, { useState, useRef } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { UserCircle, Edit2, ShieldAlert, User, Shield, KeyRound, X, Camera, LogOut } from 'lucide-react';
import Lottie from 'lottie-react';
import keyAnimation from '../assets/key-animation.json';

// 🛠️ THE FIX: Safely extract the component to bypass Vite's "Module Object" caching issue
const SafeLottie = Lottie.default || Lottie;

// ==========================================
// 🧑‍💻 PROFILE MODAL COMPONENT
// ==========================================
const ProfileModal = ({ isOpen, onClose, currentUser, setUser, onLogout }) => {
  const [editName, setEditName] = useState(currentUser?.name || "");
  const [editAvatar, setEditAvatar] = useState(currentUser?.avatar || null);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  // 画像クリックでファイル選択を開く
  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  // 選択した画像をBase64（文字列）に変換する
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditAvatar(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // 保存ボタンを押した時の処理
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`http://localhost:5000/api/users/${currentUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, avatar: editAvatar }),
      });

      if (res.ok) {
        const data = await res.json();
        
        // App.jsx を変更していなくても確実に反映させるためのフォールバック
        localStorage.setItem('jmc_user', JSON.stringify(data.user));
        
        if (setUser) {
          setUser(data.user);
          onClose();
        } else {
          // App.jsx から setUser が来ていない場合は、強制リロードして最新状態にする
          window.location.reload();
        }
      } else {
        alert("プロフィールの更新に失敗しました。ファイルサイズが大きすぎる可能性があります。");
      }
    } catch (error) {
      console.error(error);
      alert("サーバーエラーが発生しました。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(currentUser?.name || "");
    setEditAvatar(currentUser?.avatar || null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      {/* Backdrop with blur */}
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={handleCancel}
      ></div>

      {/* Modal Container */}
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl relative z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-800">プロフィール編集</h2>
          <button 
            onClick={handleCancel}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          
          {/* Avatar Edit Section */}
          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="relative group cursor-pointer" onClick={handleImageClick}>
              <div className="w-20 h-20 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center ring-4 ring-slate-50">
                {editAvatar ? (
                  <img src={editAvatar} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <UserCircle size={80} className="text-slate-300" />
                )}
              </div>
              
              {/* Hover Overlay */}
              <div className="absolute inset-0 rounded-full bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={24} className="text-white mb-1" />
                <span className="text-white text-[10px] font-bold">画像を変更</span>
              </div>

              {/* 🟢 NEW: Remove Photo Option */}
              {editAvatar && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation(); //Click on the 'X' shouldn't open the file selector
                    setEditAvatar(null);
                  }}
                  className="absolute top-0 right-0 w-6 h-6 rounded-full bg-[#B01A24] text-white flex items-center justify-center shadow-lg transform translate-x-1/4 -translate-y-1/4"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*" 
              className="hidden" 
            />
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                氏名 (Name)
              </label>
              <input 
                type="text" 
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#B01A24]/20 focus:border-[#B01A24] transition-all text-slate-800 font-bold"
                placeholder="氏名を入力"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                権限 (Role)
              </label>
              <div className="w-full px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 flex items-center space-x-2 cursor-not-allowed">
                {currentUser?.role === 'ADMIN' ? <Shield size={16} /> : <User size={16} />}
                <span className="font-bold">{currentUser?.role === 'ADMIN' ? '管理者' : '一般ユーザー'}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 ml-1">※権限の変更はシステム管理者にお問い合わせください。</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
          
          {/* 🔴 UNIFIED RED LOGOUT BUTTON */}
          <button 
            onClick={onLogout}
            // Color changed to dark red and shadow added to match
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-[#B01A24] hover:bg-red-800 rounded-xl shadow-md shadow-red-900/10 transition-colors"
          >
            <LogOut size={16} /> ログアウト
          </button>

          <div className="flex space-x-3">
            <button 
              onClick={handleCancel}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
            >
              キャンセル
            </button>
            <button 
              onClick={handleSave}
              disabled={isSaving || !editName.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#B01A24] hover:bg-[#8e151d] shadow-md shadow-red-900/10 disabled:opacity-50 transition-colors"
            >
              {isSaving ? '保存中...' : '保存する'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};


// ==========================================
// 🏗️ MAIN LAYOUT COMPONENT
// ==========================================
export default function Layout({ currentUser, onLogout, setUser, children }) {
  const location = useLocation();
  const isAdminPage = location.pathname.includes('/admin');
  
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const linkBaseClasses = 'px-6 py-2 rounded-full text-sm transition-all duration-200 ease-out flex items-center space-x-2';
  const activeClasses = 'bg-[#B01A24] text-white font-bold shadow-[0_1px_3px_rgba(0,0,0,0.1)]'; 
  const inactiveClasses = 'text-slate-500 font-semibold hover:text-slate-800 hover:bg-slate-200/50';

  return (
    <div className="min-h-screen bg-[#FAF8F5] font-sans text-slate-800">
      
      {/* 🟢 TOP HEADER */}
      <header className="bg-black text-white px-8 py-4 flex justify-between items-center sticky top-0 z-50 shadow-md">
        
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 flex items-center justify-center">
            <SafeLottie 
              animationData={keyAnimation} 
              loop={true} 
              style={{ width: '100%', height: '100%' }}
            />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white leading-tight tracking-wide">本社キー当番</h1>
          </div>
          <div className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-full ml-1">
            <KeyRound className="text-white" size={20} />
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-right hidden md:block">
            <p className="text-sm font-bold text-white">{currentUser?.name}</p>
            <p className="text-xs text-slate-400">{currentUser?.role === 'ADMIN' ? '管理者' : '一般ユーザー'}</p>
          </div>
          
          <div 
            className="relative group cursor-pointer" 
            onClick={() => setIsProfileModalOpen(true)}
          >
            {currentUser?.avatar ? (
              <img src={currentUser.avatar} alt="Profile" className="w-10 h-10 rounded-full border-2 border-slate-700 object-cover bg-white" />
            ) : (
              <UserCircle size={40} className="text-slate-400 bg-slate-800 rounded-full" />
            )}
            <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Edit2 size={16} className="text-white" />
            </div>
          </div>
        </div>
      </header>

      {/* 🔴 FLOATING CAPSULE BUTTON */}
      <div className="fixed top-24 right-8 z-40">
        <div className="flex bg-white/90 p-1 rounded-full shadow-lg hover:shadow-xl transition-shadow border border-slate-200/50 backdrop-blur-md">
          
          <Link 
            to="/" 
            className={`${linkBaseClasses} ${!isAdminPage ? activeClasses : inactiveClasses}`}
          >
            <User size={16} strokeWidth={!isAdminPage ? 2.5 : 2} />
            <span>ユーザー</span>
          </Link>

          <div className="h-4 w-px bg-slate-300 mx-1 self-center"></div>

          {currentUser?.role === 'ADMIN' ? (
            <Link 
              to="/admin" 
              className={`${linkBaseClasses} ${isAdminPage ? activeClasses : inactiveClasses}`}
            >
              <Shield size={16} strokeWidth={isAdminPage ? 2.5 : 2} />
              <span>管理者</span>
            </Link>
          ) : (
            <div 
              className="px-6 py-2 rounded-full text-slate-400 font-semibold text-sm flex items-center space-x-2 cursor-not-allowed opacity-60"
              title="管理者権限が必要です"
            >
               <ShieldAlert size={16} />
               <span>管理者</span>
            </div>
          )}
          
        </div>
      </div>

      <main className="p-8 max-w-6xl mx-auto pt-12">
        {children || <Outlet />} 
      </main>

      <ProfileModal 
        isOpen={isProfileModalOpen} 
        onClose={() => setIsProfileModalOpen(false)} 
        currentUser={currentUser}
        setUser={setUser}
        onLogout={onLogout}
      />
      
    </div>
  );
}