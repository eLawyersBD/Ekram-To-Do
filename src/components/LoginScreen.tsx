import React, { useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Lock,
  ShieldCheck,
  UserCheck,
  UserRound,
} from 'lucide-react';
import { hashPassword, type AppUser } from '../types/auth';

interface LoginScreenProps {
  users: AppUser[];
  onAuthenticated: (user: AppUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  users,
  onAuthenticated,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalized = username.trim().toLowerCase();
    if (!normalized || !password) {
      setError('Enter both your User ID and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const matched = users.find(
        (u) => u.username.trim().toLowerCase() === normalized
      );

      if (!matched) {
        setError('Invalid User ID or password.');
        return;
      }

      if (!matched.isActive) {
        setError('This User ID has been disabled by an administrator.');
        return;
      }

      const candidateHash = await hashPassword(password);
      if (candidateHash !== matched.passwordHash) {
        setError('Invalid User ID or password.');
        return;
      }

      onAuthenticated(matched);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-[#F4F7F9] to-blue-50/50 px-4 py-10">
      <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_20px_50px_-15px_rgba(26,54,93,0.16)]">
        {/* Top Executive Gradient Banner */}
        <div className="bg-gradient-to-r from-[#0F2547] via-[#1A365D] to-[#23487A] px-7 py-6 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold tracking-wide text-blue-100 backdrop-blur-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
              <span>EXECUTIVE LEDGER PORTAL</span>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Live Sync
            </span>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/12 text-white shadow-inner backdrop-blur-xs">
              <ClipboardCheck className="h-5 w-5 text-blue-200" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                Task Plan and Status
              </h1>
              <p className="mt-0.5 text-xs text-blue-100/85">
                Client Engagement, Billing &amp; Google Drive Workflow
              </p>
            </div>
          </div>
        </div>

        {/* Sub-banner workspace domain badge */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-7 py-2.5 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Lock className="h-3 w-3 text-[#1A365D]" />
            Workspace:
            <span className="font-mono font-semibold text-slate-800">
              ekram.accounticca.com
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
            <FileSpreadsheet className="h-3 w-3" />
            Drive &amp; Sheets Ready
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-7 py-6">
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50/90 px-3.5 py-2.5 text-xs font-medium text-red-800"
            >
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="login-user-id"
              className="block text-xs font-bold text-slate-700"
            >
              User ID
            </label>
            <div className="relative mt-1.5">
              <UserRound
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="login-user-id"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your User ID"
                className="w-full rounded-xl border border-slate-300 bg-slate-50/40 py-2.5 pl-10 pr-3.5 font-mono text-sm text-slate-900 transition-all placeholder:font-sans placeholder:text-slate-400 focus:border-[#1A365D] focus:bg-white focus:outline-none focus:ring-3 focus:ring-[#1A365D]/12"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-xs font-bold text-slate-700"
            >
              Password
            </label>
            <div className="relative mt-1.5">
              <KeyRound
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full rounded-xl border border-slate-300 bg-slate-50/40 py-2.5 pl-10 pr-10 text-sm text-slate-900 transition-all placeholder:text-slate-400 focus:border-[#1A365D] focus:bg-white focus:outline-none focus:ring-3 focus:ring-[#1A365D]/12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1A365D] to-[#23487A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-[#132948] hover:to-[#1A365D] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A365D] disabled:opacity-60"
          >
            <UserCheck className="h-4 w-4" />
            {isSubmitting ? 'Signing in...' : 'Sign In to Workspace'}
          </button>
        </form>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-7 py-3 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Role-based row isolation
          </span>
          <span>BDT (৳) · Multi-Currency</span>
        </div>
      </div>
    </div>
  );
};
