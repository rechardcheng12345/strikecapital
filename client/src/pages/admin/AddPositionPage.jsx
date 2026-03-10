import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Calculator, DollarSign, TrendingUp, Percent } from 'lucide-react';
import { toast } from 'sonner';
import { positionApi } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardHeader, CardBody } from '../../components/ui/Card';
function formatCurrency(value) {
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function AddPositionPage() {
    const navigate = useNavigate();
    const [positionType, setPositionType] = useState('option');
    const { register, handleSubmit, watch, formState: { errors }, } = useForm({
        defaultValues: {
            ticker: '',
            strike_price: '',
            premium_received: '',
            contracts: '',
            expiration_date: '',
            notes: '',
        },
    });
    const createMutation = useMutation({
        mutationFn: (data) => positionApi.create(data),
        onSuccess: (response) => {
            if (response.error) {
                toast.error(response.error);
                return;
            }
            toast.success('Position created successfully');
            navigate('/admin/positions');
        },
        onError: () => {
            toast.error('Failed to create position');
        },
    });
    function onSubmit(values) {
        const payload = {
            ticker: values.ticker.toUpperCase().trim(),
            position_type: positionType,
            strike_price: parseFloat(values.strike_price),
            premium_received: parseFloat(values.premium_received),
            contracts: positionType === 'stock' ? 0 : parseInt(values.contracts, 10),
            expiration_date: positionType === 'stock' ? undefined : values.expiration_date,
            notes: values.notes.trim() || undefined,
            ...(positionType === 'stock' && {
                shares: parseInt(values.contracts, 10),
                cost_basis: parseFloat(values.strike_price),
            }),
        };
        createMutation.mutate(payload);
    }
    // Live calculation values
    const watchStrike = parseFloat(watch('strike_price')) || 0;
    const watchPremium = parseFloat(watch('premium_received')) || 0;
    const watchContracts = parseInt(watch('contracts'), 10) || 0;
    const isStock = positionType === 'stock';
    const collateral = isStock
        ? watchStrike * watchContracts
        : watchStrike * watchContracts * 100;
    const breakEven = watchContracts > 0 && watchStrike > 0
        ? isStock
            ? watchStrike - (watchPremium / watchContracts)
            : watchStrike - (watchPremium / (watchContracts * 100))
        : 0;
    const maxProfit = watchPremium;
    const returnOnCollateral = collateral > 0
        ? (watchPremium / collateral) * 100
        : 0;
    const hasCalcValues = watchStrike > 0 && watchContracts > 0;
    return (<div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/admin/positions">
          <Button variant="ghost" size="sm" className="rounded-none">
            <ArrowLeft className="w-4 h-4 mr-1"/>
            Back
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Add Position
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="lg:col-span-2">
          <Card className="rounded-none">
            <CardHeader className="bg-[#0D2654]">
              <h2 className="text-lg font-semibold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {isStock ? 'Stock Position Details' : 'Cash-Secured Put Details'}
              </h2>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                {/* Position Type Toggle */}
                <div className="flex gap-2 mb-6">
                  <button type="button" onClick={() => setPositionType('option')} className={`px-4 py-2 text-sm font-medium rounded-none border-2 transition-colors ${positionType === 'option'
            ? 'border-[#0D2654] bg-[#0D2654] text-white'
            : 'border-[#0D2654]/20 text-[#0D2654] hover:border-[#0D2654]/40'}`}>
                    Cash-Secured Put
                  </button>
                  <button type="button" onClick={() => setPositionType('stock')} className={`px-4 py-2 text-sm font-medium rounded-none border-2 transition-colors ${positionType === 'stock'
            ? 'border-[#0D2654] bg-[#0D2654] text-white'
            : 'border-[#0D2654]/20 text-[#0D2654] hover:border-[#0D2654]/40'}`}>
                    Stock Position
                  </button>
                </div>

                {/* Ticker */}
                <div>
                  <Input label="Ticker Symbol" placeholder="e.g. AAPL" className="rounded-none uppercase" {...register('ticker', {
        required: 'Ticker is required',
        setValueAs: (v) => v.toUpperCase(),
    })} error={errors.ticker?.message}/>
                </div>

                {/* Strike/Cost Basis & Premium row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label={isStock ? 'Cost Basis ($)' : 'Strike Price ($)'} type="number" step="0.01" min="0.01" placeholder="0.00" className="rounded-none" {...register('strike_price', {
        required: isStock ? 'Cost basis is required' : 'Strike price is required',
        validate: (v) => parseFloat(v) > 0 || (isStock ? 'Cost basis must be greater than 0' : 'Strike price must be greater than 0'),
    })} error={errors.strike_price?.message}/>
                  <Input label="Premium Received ($)" type="number" step="0.01" min="0.01" placeholder="0.00" className="rounded-none" {...register('premium_received', {
        required: 'Premium is required',
        validate: (v) => parseFloat(v) > 0 || 'Premium must be greater than 0',
    })} error={errors.premium_received?.message}/>
                </div>

                {/* Contracts/Shares & Expiration row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label={isStock ? 'Shares' : 'Contracts'} type="number" step="1" min="1" placeholder="1" className="rounded-none" {...register('contracts', {
        required: isStock ? 'Shares is required' : 'Contracts is required',
        validate: (v) => parseInt(v, 10) >= 1 || (isStock ? 'Must be at least 1 share' : 'Must be at least 1 contract'),
    })} error={errors.contracts?.message}/>
                  {!isStock && (<Input label="Expiration Date" type="date" className="rounded-none" {...register('expiration_date', {
            required: !isStock ? 'Expiration date is required' : false,
        })} error={errors.expiration_date?.message}/>)}
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea className="block w-full px-3 py-2 border border-gray-300 rounded-none shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F06010] focus:border-[#F06010] sm:text-sm min-h-[80px] resize-y" placeholder="Optional notes about this position..." {...register('notes')}/>
                </div>

                {/* Submit */}
                <div className="flex justify-end gap-3 pt-2">
                  <Link to="/admin/positions">
                    <Button variant="outline" type="button" className="rounded-none">
                      Cancel
                    </Button>
                  </Link>
                  <Button type="submit" variant="primary" className="bg-[#F06010] hover:bg-[#d9560e] rounded-none" loading={createMutation.isPending}>
                    Create Position
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>
        </div>

        {/* Live Calculation Preview */}
        <div className="lg:col-span-1">
          <Card className="rounded-none sticky top-6">
            <CardHeader className="bg-[#F5F3EF]">
              <h2 className="text-lg font-semibold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                <Calculator className="w-5 h-5 text-[#F06010]"/>
                Calculation Preview
              </h2>
            </CardHeader>
            <CardBody className="space-y-5">
              {!hasCalcValues ? (<p className="text-sm text-gray-400 text-center py-4">
                  Enter strike price and contracts to see computed values.
                </p>) : (<>
                  {/* Collateral */}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-[#0D2654] flex items-center justify-center rounded-none flex-shrink-0">
                      <DollarSign className="w-5 h-5 text-white"/>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {isStock ? 'Total Cost' : 'Collateral Required'}
                      </p>
                      <p className="text-xl font-bold text-[#0D2654] font-mono">
                        {formatCurrency(collateral)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {isStock
                ? `${formatCurrency(watchStrike)} x ${watchContracts}`
                : `${formatCurrency(watchStrike)} x ${watchContracts} x 100`}
                      </p>
                    </div>
                  </div>

                  {/* Break-Even */}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-[#F06010] flex items-center justify-center rounded-none flex-shrink-0">
                      <TrendingUp className="w-5 h-5 text-white"/>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Break-Even Price
                      </p>
                      <p className="text-xl font-bold text-[#0D2654] font-mono">
                        {formatCurrency(breakEven)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {isStock ? 'Cost Basis - (Premium / Shares)' : 'Strike - (Premium / Shares)'}
                      </p>
                    </div>
                  </div>

                  {/* Max Profit */}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-green-600 flex items-center justify-center rounded-none flex-shrink-0">
                      <DollarSign className="w-5 h-5 text-white"/>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Max Profit
                      </p>
                      <p className="text-xl font-bold text-green-700 font-mono">
                        {isStock ? 'Unlimited' : formatCurrency(maxProfit)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {isStock ? 'Stock can appreciate indefinitely' : 'Total premium received'}
                      </p>
                    </div>
                  </div>

                  {/* Return on Collateral */}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-[#0D2654] flex items-center justify-center rounded-none flex-shrink-0">
                      <Percent className="w-5 h-5 text-white"/>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Return on Collateral
                      </p>
                      <p className="text-xl font-bold text-[#F06010] font-mono">
                        {returnOnCollateral.toFixed(2)}%
                      </p>
                      <p className="text-xs text-gray-400">
                        Premium / Collateral
                      </p>
                    </div>
                  </div>
                </>)}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>);
}
