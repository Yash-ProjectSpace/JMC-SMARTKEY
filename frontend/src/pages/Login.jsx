import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useLottie } from "lottie-react";
import loginAnimationData from '../assets/new-login-anim.json'; 

export default function Login({ onGoogleSuccess, onManualLogin, loginError }) {
  const [manualEmail, setManualEmail] = useState('');

  const lottieOptions = {
    animationData: loginAnimationData,
    loop: true,
    autoplay: true,
  };
  const { View } = useLottie(lottieOptions);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const cleanedEmail = manualEmail.trim(); 
    if (cleanedEmail !== '') {
      onManualLogin(cleanedEmail);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F5EC] flex items-center justify-center p-6 lg:p-12">
      {/* 🟢 画面全体の背景色をライトベージュ (#F9F5EC) に設定しました */}
      
      {/* メインのスプリットコンテナ */}
      <div className="w-full max-w-5xl flex flex-col lg:flex-row items-center justify-center gap-12 lg:gap-16">
        
        {/* 🟢 左側: アニメーションとテキスト */}
        <div className="w-full lg:w-1/2 flex flex-col items-center justify-center pointer-events-none">
          
          {/* 透明な余白をカットするレイアウト構造 */}
          <div className="relative w-full h-48 lg:h-72 flex items-center justify-center mb-6 lg:mb-8">
            <div className="absolute transform scale-[1.7] lg:scale-[2.2] w-64 h-64 lg:w-96 lg:h-96 flex items-center justify-center">
              {View}
            </div>
          </div>
          
          {/* テキスト部分 */}
          <div className="text-center z-10">
            <h2 className="text-3xl font-bold text-slate-800 tracking-wider">本社キー当番</h2>
            <p className="text-slate-600 mt-3 text-base lg:text-lg">鍵開けスケジュールの管理・通知をスマートに自動化。</p>
          </div>
          
        </div>

        {/* 🟢 右側: ログインカード */}
        <div className="w-full lg:w-1/2 flex justify-center">
          <div className="bg-white p-8 md:p-10 rounded-3xl shadow-xl shadow-stone-200/50 border border-stone-100 max-w-md w-full text-center z-10">
            
            <h1 className="text-2xl font-extrabold text-[#B01A24] mb-2">本社キー当番</h1>
            <p className="text-slate-500 mb-8 text-sm">会社のGoogleアカウントでログインしてください。</p>
            
            {/* Googleログインボタン */}
            <div className="flex justify-center mb-8">
              <GoogleLogin
                onSuccess={onGoogleSuccess}
                onError={() => alert("Googleログインに失敗しました。")}
                useOneTap
              />
            </div>

            {/* テスト用手動ログインフォーム */}
            <div className="relative flex py-4 items-center mb-4">
              <div className="flex-grow border-t border-stone-200"></div>
              <span className="flex-shrink-0 mx-4 text-slate-400 text-xs font-bold tracking-wider">テスト用ログイン</span>
              <div className="flex-grow border-t border-stone-200"></div>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-4">
              <input 
                type="email" 
                placeholder="テスト用メールアドレスを入力" 
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#B01A24]/20 focus:border-[#B01A24] transition-all"
              />
              <button 
                type="submit"
                className="w-full py-3 bg-slate-800 hover:bg-black text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
              >
                手動でログイン
              </button>
            </form>

            {loginError && (
              <div className="mt-6 p-4 bg-red-50 rounded-xl border border-red-100">
                <p className="text-red-600 text-sm font-bold">
                  {loginError}
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}