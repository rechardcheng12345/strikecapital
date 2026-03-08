import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { userApi } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { Card, CardBody, CardHeader, Button, Input } from '../../components/ui';
import { User, Mail, Phone, Shield, Lock } from 'lucide-react';

interface ProfileForm {
  full_name: string;
  phone: string;
}

export function ProfilePage() {
  const { user, updateUser } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ProfileForm>({
    defaultValues: {
      full_name: user?.full_name || '',
      phone: user?.phone || '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: ProfileForm) => userApi.updateProfile(data),
    onSuccess: (response) => {
      if (response.error) {
        toast.error(response.error);
        return;
      }
      if (response.data) {
        updateUser(response.data);
        toast.success('Profile updated');
      }
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (data: { current_password: string; new_password: string }) =>
      userApi.changePassword(data),
    onSuccess: (response) => {
      if (response.error) {
        toast.error(response.error);
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed successfully');
    },
  });

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    changePasswordMutation.mutate({
      current_password: currentPassword,
      new_password: newPassword,
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        Profile Settings
      </h1>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-[#0D2654] rounded-full flex items-center justify-center">
              <span className="text-xl font-semibold text-white">
                {user?.full_name?.[0]?.toUpperCase() || 'U'}
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-900">{user?.full_name}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="label flex items-center">
                  <User className="w-4 h-4 mr-2 text-gray-400" />
                  Full Name
                </label>
                <Input
                  {...register('full_name', {
                    required: 'Full name is required',
                    minLength: { value: 2, message: 'Name must be at least 2 characters' },
                  })}
                  error={errors.full_name?.message}
                />
              </div>

              <div>
                <label className="label flex items-center">
                  <Mail className="w-4 h-4 mr-2 text-gray-400" />
                  Email
                </label>
                <Input value={user?.email || ''} disabled className="bg-gray-50" />
                <p className="mt-1 text-xs text-gray-500">Email cannot be changed</p>
              </div>

              <div>
                <label className="label flex items-center">
                  <Phone className="w-4 h-4 mr-2 text-gray-400" />
                  Phone
                </label>
                <Input {...register('phone')} placeholder="e.g., 012-345 6789" />
              </div>

              <div>
                <label className="label flex items-center">
                  <Shield className="w-4 h-4 mr-2 text-gray-400" />
                  Role
                </label>
                <Input
                  value={user?.role === 'admin' ? 'Administrator' : 'Investor'}
                  disabled
                  className="bg-gray-50 capitalize"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending} disabled={!isDirty}>
                Save Changes
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">Account Info</h2>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-none">
              <p className="text-sm text-gray-600">Role</p>
              <p className="text-lg font-semibold text-[#0D2654] capitalize">
                {user?.role || 'N/A'}
              </p>
            </div>
            <div className="p-4 bg-gray-50 rounded-none">
              <p className="text-sm text-gray-600">Member Since</p>
              <p className="text-lg font-semibold text-gray-900">
                {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900 flex items-center">
            <Lock className="w-4 h-4 mr-2" />
            Change Password
          </h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="label">Current Password</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">New Password</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                />
              </div>
              <div>
                <label className="label">Confirm New Password</label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                loading={changePasswordMutation.isPending}
                disabled={!currentPassword || !newPassword || !confirmPassword}
              >
                Change Password
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
