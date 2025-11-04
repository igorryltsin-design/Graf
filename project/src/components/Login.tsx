import { useState } from 'react';
import { User as LucideUser } from 'lucide-react';
import { User, findUserByUsername } from '../lib/supabase';

interface LoginProps {
  onLogin: (user: User) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await findUserByUsername(username);

      if (!data) {
        setError('Пользователь не найден');
        setLoading(false);
        return;
      }

      onLogin(data);
    } catch (err: any) {
      setError(err.message || 'Не удалось выполнить вход');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (user: string) => {
    setUsername(user);
    setTimeout(() => {
      const form = document.querySelector('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }, 100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-800 rounded-lg shadow-2xl border border-slate-700 p-8">
          <div className="flex items-center justify-center mb-8">
            <div className="bg-slate-700 p-3 rounded-full">
              <LucideUser className="w-8 h-8 text-slate-200" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-center text-slate-100 mb-2">
            Система MLS/ABAC
          </h1>
          <p className="text-center text-slate-400 mb-8 text-sm">
            Многоуровневое управление доступом
          </p>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-slate-300 mb-2">
                Имя пользователя
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Введите имя пользователя"
                required
              />
            </div>

            {error && (
              <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium py-3 rounded-lg transition-colors duration-200"
            >
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-700">
            <p className="text-sm text-slate-400 mb-3">Быстрый вход:</p>
            <div className="space-y-2">
              <button
                onClick={() => quickLogin('analyst_a')}
                className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 py-2 px-4 rounded text-sm transition-colors duration-200 text-left"
              >
                <span className="font-medium">analyst_a</span>
                <span className="text-slate-400 ml-2 text-xs">
                  (CONFIDENTIAL, сектор A)
                </span>
              </button>
              <button
                onClick={() => quickLogin('commander')}
                className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 py-2 px-4 rounded text-sm transition-colors duration-200 text-left"
              >
                <span className="font-medium">commander</span>
                <span className="text-slate-400 ml-2 text-xs">
                  (SECRET, все секторы)
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
