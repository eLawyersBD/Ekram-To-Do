import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import type { ConfirmDialogRequest } from '../types/task';

interface ConfirmModalProps {
  request: ConfirmDialogRequest | null;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ request, onClose }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [request, isSubmitting, onClose]);

  if (!request) return null;

  const isDanger = request.tone === 'danger';

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await request.onConfirm();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            {isDanger ? (
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-5 w-5 shrink-0 text-[#1A365D]" aria-hidden="true" />
            )}
            <h3
              id="confirm-modal-title"
              className="text-base font-semibold text-slate-900"
            >
              {request.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close confirmation dialog"
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-[#1A365D]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <p className="text-sm leading-relaxed text-slate-700">
            {request.description}
          </p>
          {request.details && request.details.length > 0 && (
            <ul className="space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
              {request.details.map((item, idx) => (
                <li key={idx} className="truncate font-mono">
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#1A365D] whitespace-nowrap"
          >
            {request.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 whitespace-nowrap disabled:opacity-60 ${
              isDanger
                ? 'bg-red-700 hover:bg-red-800 focus-visible:outline-red-700'
                : 'bg-[#1A365D] hover:bg-[#132948] focus-visible:outline-[#1A365D]'
            }`}
          >
            {isSubmitting ? 'Processing...' : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
