import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Settings, DollarSign, Hash, Percent, Building2, Clock } from 'lucide-react';
import { fundApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Card, CardBody, CardHeader, CardFooter, Button, Input, Skeleton, ErrorAlert } from '../../components/ui';
function SettingsSkeleton() {
    return (<Card className="rounded-none">
      <CardHeader>
        <Skeleton variant="text" className="w-48 h-6"/>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 5 }).map((_, i) => (<div key={i} className="space-y-2">
              <Skeleton variant="text" className="w-32 h-4"/>
              <Skeleton variant="rectangular" height={40}/>
            </div>))}
        </div>
      </CardBody>
      <CardFooter className="rounded-none">
        <div className="flex justify-end gap-3">
          <Skeleton variant="rectangular" width={80} height={36}/>
          <Skeleton variant="rectangular" width={120} height={36}/>
        </div>
      </CardFooter>
    </Card>);
}
function formatTimestamp(iso) {
    return new Date(iso).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
export function AdminSettingsPage() {
    const { data: settings, isLoading, isError, error, refetch } = useApiQuery({
        queryKey: ['fund-settings'],
        queryFn: () => fundApi.getSettings(),
    });
    const { register, handleSubmit, reset, formState: { errors, isDirty }, } = useForm();
    // Reset form when settings load
    useEffect(() => {
        if (settings) {
            reset({
                fund_name: settings.fund_name,
                total_fund_capital: settings.total_fund_capital,
                max_capital_per_position: settings.max_capital_per_position,
                max_positions: settings.max_positions,
                default_alert_threshold: settings.default_alert_threshold,
            });
        }
    }, [settings, reset]);
    const mutation = useMutation({
        mutationFn: (data) => fundApi.updateSettings({
            fund_name: data.fund_name,
            total_fund_capital: Number(data.total_fund_capital),
            max_capital_per_position: Number(data.max_capital_per_position),
            max_positions: Number(data.max_positions),
            default_alert_threshold: Number(data.default_alert_threshold),
        }),
        onSuccess: (response) => {
            if (response.error) {
                toast.error(response.error);
                return;
            }
            if (response.data) {
                reset({
                    fund_name: response.data.fund_name,
                    total_fund_capital: response.data.total_fund_capital,
                    max_capital_per_position: response.data.max_capital_per_position,
                    max_positions: response.data.max_positions,
                    default_alert_threshold: response.data.default_alert_threshold,
                });
                toast.success('Fund settings updated successfully');
                refetch();
            }
        },
    });
    const handleReset = () => {
        if (settings) {
            reset({
                fund_name: settings.fund_name,
                total_fund_capital: settings.total_fund_capital,
                max_capital_per_position: settings.max_capital_per_position,
                max_positions: settings.max_positions,
                default_alert_threshold: settings.default_alert_threshold,
            });
        }
    };
    return (<div className="space-y-6 max-w-3xl">
      {/* Header */}
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        <Settings className="w-6 h-6 text-[#F06010]"/>
        Fund Settings
      </h1>

      {/* Error State */}
      {isError && (<ErrorAlert message={error?.message} onRetry={() => refetch()}/>)}

      {/* Loading State */}
      {isLoading && <SettingsSkeleton />}

      {/* Settings Form */}
      {settings && !isLoading && (<form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
          <Card className="rounded-none">
            <CardHeader className="rounded-none">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                  <Building2 className="w-5 h-5 inline mr-2 text-[#F06010]"/>
                  Configuration
                </h2>
                {settings.updated_at && (<div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Clock className="w-3.5 h-3.5"/>
                    Last updated: {formatTimestamp(settings.updated_at)}
                  </div>)}
              </div>
            </CardHeader>

            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Fund Name */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-gray-400"/>
                    Fund Name
                  </label>
                  <Input {...register('fund_name', {
            required: 'Fund name is required',
            minLength: { value: 2, message: 'Must be at least 2 characters' },
        })} error={errors.fund_name?.message} className="rounded-none"/>
                </div>

                {/* Total Fund Capital */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-gray-400"/>
                    Total Fund Capital ($)
                  </label>
                  <Input type="number" step="0.01" {...register('total_fund_capital', {
            required: 'Total fund capital is required',
            min: { value: 0, message: 'Must be positive' },
            valueAsNumber: true,
        })} error={errors.total_fund_capital?.message} className="rounded-none"/>
                </div>

                {/* Max Capital Per Position */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-gray-400"/>
                    Max Capital Per Position ($)
                  </label>
                  <Input type="number" step="0.01" {...register('max_capital_per_position', {
            required: 'Max capital per position is required',
            min: { value: 0, message: 'Must be positive' },
            valueAsNumber: true,
        })} error={errors.max_capital_per_position?.message} className="rounded-none"/>
                </div>

                {/* Max Positions */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                    <Hash className="w-4 h-4 text-gray-400"/>
                    Max Positions
                  </label>
                  <Input type="number" step="1" {...register('max_positions', {
            required: 'Max positions is required',
            min: { value: 1, message: 'Must be at least 1' },
            valueAsNumber: true,
        })} error={errors.max_positions?.message} className="rounded-none"/>
                </div>

                {/* Default Alert Threshold */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                    <Percent className="w-4 h-4 text-gray-400"/>
                    Default Alert Threshold (%)
                  </label>
                  <Input type="number" step="0.1" {...register('default_alert_threshold', {
            required: 'Alert threshold is required',
            min: { value: 0, message: 'Must be non-negative' },
            max: { value: 100, message: 'Cannot exceed 100%' },
            valueAsNumber: true,
        })} error={errors.default_alert_threshold?.message} className="rounded-none"/>
                </div>
              </div>
            </CardBody>

            <CardFooter className="rounded-none">
              <div className="flex items-center justify-end gap-3">
                <Button type="button" variant="outline" className="rounded-none" onClick={handleReset} disabled={!isDirty || mutation.isPending}>
                  Reset
                </Button>
                <Button type="submit" className="rounded-none bg-[#0D2654] hover:bg-[#0D2654]/90" loading={mutation.isPending} disabled={!isDirty}>
                  Save Settings
                </Button>
              </div>
            </CardFooter>
          </Card>
        </form>)}
    </div>);
}
