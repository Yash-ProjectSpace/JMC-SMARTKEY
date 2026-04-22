// src/App.jsx
import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { jwtDecode } from "jwt-decode";

import Login from './pages/Login';
import Layout from './components/Layout';
import AdminDashboard from './pages/AdminDashboard'; 
import UserDashboard from './pages/UserDashboard'; 

export default function App() {
  // 🟢 修正1：初期状態で localStorage をチェックし、データがあれば復元する
  const [currentUser, setCurrentUser] = useState(() => {
    const savedUser = localStorage.getItem('jmc_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [loginError, setLoginError] = useState("");
  
  const navigate = useNavigate(); 

  const handleGoogleSuccess = async (credentialResponse) => {
    const decoded = jwtDecode(credentialResponse.credential);
    const userEmail = decoded.email;

    try {
      const response = await fetch('https://kiitoban.jmc-ltd.co.jp/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail })
      });

      const data = await response.json();

      if (response.ok) {
        // 🟢 修正2：状態（State）だけでなく、localStorage にも保存する
        setCurrentUser(data.user);
        localStorage.setItem('jmc_user', JSON.stringify(data.user));
        
        setLoginError("");
        
        if (data.user.role === 'ADMIN') {
          navigate('/admin');
        } else {
          navigate('/');
        }
      } else {
        setLoginError("アクセスが拒否されました。登録されていないメールアドレスです。");
      }
    } catch (error) {
      setLoginError("サーバーエラーが発生しました。");
    }
  };

  // 🟢 NEW: テスト用手動ログイン機能
  const handleManualLogin = async (userEmail) => {
    try {
      const response = await fetch('https://kiitoban.jmc-ltd.co.jp/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail })
      });

      const data = await response.json();

      if (response.ok) {
        setCurrentUser(data.user);
        localStorage.setItem('jmc_user', JSON.stringify(data.user));
        setLoginError("");
        
        if (data.user.role === 'ADMIN') {
          navigate('/admin');
        } else {
          navigate('/');
        }
      } else {
        setLoginError("無効なユーザーです。ログインできません。(Invalid user)");
      }
    } catch (error) {
      setLoginError("サーバーエラーが発生しました。");
    }
  };

  const handleLogout = () => {
    // 🟢 修正3：ログアウト時は localStorage からもデータを削除する
    setCurrentUser(null);
    localStorage.removeItem('jmc_user');
    navigate('/'); 
  };

  if (!currentUser) {
    return (
      <Login 
        onGoogleSuccess={handleGoogleSuccess} 
        onManualLogin={handleManualLogin} // 🟢 追加
        loginError={loginError} 
      />
    );
  }

  return (
    <Layout currentUser={currentUser} onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<UserDashboard currentUser={currentUser} />} />
        <Route 
          path="/admin" 
          element={currentUser.role === 'ADMIN' ? <AdminDashboard /> : <Navigate to="/" />} 
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}