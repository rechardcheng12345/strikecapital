import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../../api/client';
import { Button, Input, Card, CardBody } from '../../components/ui';
import { ArrowLeft } from 'lucide-react';
export function ResetPasswordPage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') || '';
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);
    const { register, handleSubmit, watch, formState: { errors }, } = useForm();
    const password = watch('password');
    const onSubmit = async (data) => {
        if (!token) {
            setError('Invalid reset link. Please request a new password reset.');
            return;
        }
        setLoading(true);
        setError('');
        const { error } = await authApi.resetPassword(token, data.password);
        setLoading(false);
        if (error) {
            setError(error);
            return;
        }
        setSuccess(true);
    };
    // No token in URL
    if (!token) {
        return (<div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <div className="w-12 h-12 bg-[#F06010] rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xl">S</span>
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
            Invalid Reset Link
          </h2>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <Card>
            <CardBody>
              <div className="text-center">
                <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Invalid or Missing Token</h3>
                <p className="text-gray-600 mb-4">
                  This password reset link is invalid or has expired. Please request a new one.
                </p>
                <Link to="/forgot-password" className="text-primary-600 hover:text-primary-500 font-medium">
                  Request new reset link
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>);
    }
    return (<div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 bg-[#F06010] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-xl">S</span>
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
          Set new password
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Enter your new password below.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Card>
          <CardBody>
            {success ? (<div className="text-center">
                <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Password reset successful</h3>
                <p className="text-gray-600 mb-4">
                  Your password has been updated. You can now sign in with your new password.
                </p>
                <Link to="/login" className="inline-flex items-center justify-center px-4 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors">
                  Sign in
                </Link>
              </div>) : (<form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {error && (<div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                    {error}
                  </div>)}

                <Input label="New password" type="password" {...register('password', {
            required: 'Password is required',
            minLength: {
                value: 6,
                message: 'Password must be at least 6 characters',
            },
        })} error={errors.password?.message}/>

                <Input label="Confirm new password" type="password" {...register('confirmPassword', {
            required: 'Please confirm your password',
            validate: (value) => value === password || 'Passwords do not match',
        })} error={errors.confirmPassword?.message}/>

                <Button type="submit" className="w-full" loading={loading}>
                  Reset password
                </Button>

                <div className="text-center">
                  <Link to="/login" className="inline-flex items-center text-sm text-gray-600 hover:text-primary-600">
                    <ArrowLeft className="w-4 h-4 mr-1"/>
                    Back to sign in
                  </Link>
                </div>
              </form>)}
          </CardBody>
        </Card>
      </div>
    </div>);
}
