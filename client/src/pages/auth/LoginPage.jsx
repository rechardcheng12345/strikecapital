import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { authApi } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { Button, Input } from '../../components/ui';
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
    return (<div className="min-h-screen flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#0D2654] flex-col justify-center items-center px-12">
        <div className="max-w-md text-center">
          <img src="/logo2.png" alt="StrikeCapital" className="w-16 h-16 rounded-lg mx-auto mb-8"/>
          <h1 className="text-4xl font-bold text-white mb-4 tracking-tight" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            StrikeCapital
          </h1>
          <p className="text-lg text-gray-300">
            Smarter Options, Better Returns
          </p>
        </div>
      </div>

      {/* Right login form */}
      <div className="w-full lg:w-1/2 bg-[#F5F3EF] flex flex-col justify-center py-12 px-6 sm:px-12">
        <div className="max-w-md w-full mx-auto">
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <img src="/logo2.png" alt="StrikeCapital" className="w-12 h-12 rounded-lg"/>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-8" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Sign in to your account
          </h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {isDev && (<div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => {
                setValue('email', 'admin@strikecapital.com');
                setValue('password', 'admin123');
            }}>
                  Admin
                </Button>
                <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => {
                setValue('email', 'investor@strikecapital.com');
                setValue('password', 'investor123');
            }}>
                  Investor
                </Button>
              </div>)}

            {error && (<div className="p-3 bg-red-50 border border-red-200 rounded-none text-sm text-red-600">
                {error}
              </div>)}

            <Input label="Email address" type="email" {...register('email', {
        required: 'Email is required',
        pattern: {
            value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
            message: 'Invalid email address',
        },
    })} error={errors.email?.message}/>

            <Input label="Password" type="password" {...register('password', {
        required: 'Password is required',
    })} error={errors.password?.message}/>

            <div className="flex items-center justify-between">
              <div className="text-sm">
                <Link to="/forgot-password" className="text-[#F06010] hover:text-[#E85A10]">
                  Forgot your password?
                </Link>
              </div>
            </div>

            <Button type="submit" className="w-full bg-[#F06010] hover:bg-[#E85A10]" loading={loading}>
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>);
}
