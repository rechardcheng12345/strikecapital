import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

interface SuccessAnimationProps {
  show: boolean;
  onComplete?: () => void;
  duration?: number;
  message?: string;
}

export function SuccessAnimation({
  show,
  onComplete,
  duration = 2000,
  message = 'Success!',
}: SuccessAnimationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        onComplete?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onComplete]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="animate-fade-in-up flex flex-col items-center">
        <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center animate-scale-check shadow-lg">
          <Check className="w-10 h-10 text-white" strokeWidth={3} />
        </div>
        <p className="mt-3 text-lg font-semibold text-gray-900 bg-white/90 px-4 py-1 rounded-full shadow">
          {message}
        </p>
      </div>
    </div>
  );
}
