import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { authApi } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { Button, Input } from '../../components/ui';
import { Wordmark } from '../../components/layout/AppShell';

/** Brand panel: faint ledger grid, an editorial line, and a slowly drawn equity curve. */
function BrandPanel() {
    return (<div className="relative hidden lg:flex lg:w-[52%] bg-ink-950 overflow-hidden flex-col justify-between p-14 xl:p-16">
      {/* ledger grid */}
      <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)', backgroundSize: '72px 72px' }} aria-hidden/>
      <div className="absolute -right-40 -top-40 w-[520px] h-[520px] rounded-full bg-accent/10 blur-[120px]" aria-hidden/>

      <div className="relative flex items-center gap-3 animate-rise">
        <img src="/logo2.png" alt="" className="w-9 h-9"/>
        <Wordmark/>
      </div>

      <div className="relative">
        <p className="flex items-center gap-2 text-[11px] uppercase tracking-eyebrow text-white/45 animate-rise [animation-delay:120ms]">
          <span className="w-3 h-px bg-accent"/>Private options fund
        </p>
        <h1 className="mt-6 font-display text-white text-[52px] xl:text-[60px] leading-[1.02] animate-rise [animation-delay:220ms]">
          Patient capital,<br/><span className="!font-light text-white/80">precisely</span> deployed.
        </h1>
        <p className="mt-7 max-w-md text-[15px] leading-relaxed text-white/55 animate-rise [animation-delay:340ms]">
          Cash-secured puts on quality names, sized with care and reported to every investor with full transparency.
        </p>
      </div>

      {/* equity curve */}
      <div className="relative -mx-14 xl:-mx-16 -mb-14 xl:-mb-16 h-[220px]" aria-hidden>
        <svg viewBox="0 0 800 220" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="loginFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F06010" stopOpacity="0.22"/>
              <stop offset="100%" stopColor="#F06010" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d="M0,190 C60,182 90,176 140,170 C190,164 220,170 270,150 C320,130 350,138 400,120 C450,102 480,110 530,88 C580,66 610,74 660,52 C700,36 740,30 800,18 L800,220 L0,220 Z" fill="url(#loginFill)" className="animate-rise [animation-delay:600ms]"/>
          <path d="M0,190 C60,182 90,176 140,170 C190,164 220,170 270,150 C320,130 350,138 400,120 C450,102 480,110 530,88 C580,66 610,74 660,52 C700,36 740,30 800,18" fill="none" stroke="#F06010" strokeWidth="1.75" strokeDasharray="1200" className="animate-draw-line"/>
        </svg>
      </div>
    </div>);
}

export function LoginPage() {
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { setAuth } = useAuthStore();
    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || '/';
    const isDev = import.meta.env.DEV;
    const { register, handleSubmit, setValue, formState: { errors }, } = useForm();
    const onSubmit = async (data) => {
        setLoading(true);
        setError('');
        const { data: result, error } = await authApi.login(data.email, data.password);
        setLoading(false);
        if (error) {
            setError(error);
            return;
        }
        if (result) {
            setAuth(result.user, result.token);
            // Route admin to admin dashboard, investor to investor dashboard
            const destination = result.user.role === 'admin' ? '/admin' : from;
            navigate(destination, { replace: true });
        }
    };
    return (<div className="min-h-screen flex bg-paper">
      <BrandPanel/>

      <div className="w-full lg:w-[48%] flex flex-col justify-center py-12 px-6 sm:px-12 lg:px-16 xl:px-24">
        <div className="max-w-[400px] w-full mx-auto">
          <div className="lg:hidden flex items-center gap-2.5 mb-14">
            <img src="/logo2.png" alt="" className="w-8 h-8"/>
            <Wordmark light={false} size="sm"/>
          </div>

          <p className="flex items-center gap-2 text-[11px] uppercase tracking-eyebrow text-muted animate-rise"><span className="w-3 h-px bg-accent"/>Investor &amp; manager access</p>
          <h2 className="mt-4 font-display text-[42px] leading-none text-ink animate-rise [animation-delay:80ms]">Welcome back.</h2>
          <p className="mt-3 text-[15px] text-muted animate-rise [animation-delay:140ms]">Sign in to see your account and the fund&apos;s positions.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-10 space-y-5 animate-rise [animation-delay:200ms]">
            {isDev && (<div className="flex gap-2 pb-1">
                <Button type="button" variant="ghost" size="sm" className="flex-1 border border-dashed border-line-strong" onClick={() => {
                setValue('email', 'admin@strikecapital.com');
                setValue('password', 'admin123');
            }}>
                  Dev: admin
                </Button>
                <Button type="button" variant="ghost" size="sm" className="flex-1 border border-dashed border-line-strong" onClick={() => {
                setValue('email', 'investor@strikecapital.com');
                setValue('password', 'investor123');
            }}>
                  Dev: investor
                </Button>
              </div>)}

            {error && (<div className="px-4 py-3 bg-red-50/70 border border-red-100 border-l-2 border-l-red-600 text-sm text-red-700">
                {error}
              </div>)}

            <Input label="Email address" type="email" autoComplete="email" {...register('email', {
        required: 'Email is required',
        pattern: {
            value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
            message: 'Invalid email address',
        },
    })} error={errors.email?.message} className="h-12"/>

            <div>
              <Input label="Password" type="password" autoComplete="current-password" {...register('password', {
        required: 'Password is required',
    })} error={errors.password?.message} className="h-12"/>
              <div className="mt-2 text-right">
                <Link to="/forgot-password" className="text-[13px] text-muted hover:text-ink underline-offset-4 hover:underline">
                  Forgot your password?
                </Link>
              </div>
            </div>

            <Button type="submit" variant="accent" size="lg" className="w-full group" loading={loading}>
              Sign in
              {!loading && <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5"/>}
            </Button>
          </form>

          <p className="mt-14 text-[12px] leading-relaxed text-muted/80">
            Your session is encrypted. Investors see only their own account; positions are shared with all investors for transparency.
          </p>
        </div>
      </div>
    </div>);
}
